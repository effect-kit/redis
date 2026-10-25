import { Cause, Context, Effect, Layer, Redacted, Schema, Stream } from "effect";

import type { Command, PreparedCommand } from "#/command/Command";
import { checkServerReply, decodeReply } from "#/command/Decode";
import { integer, status, undecorate } from "#/command/reply/Scalars";
import { parse } from "#/commands/internal/Input";
import { getBytes } from "#/commands/strings/Get";
import { trackingInfo, trackingTokens } from "#/commands/tracking/Controls";
import { checkOrdinary } from "#/connection/OrdinaryCommand";
import { ConnectionError } from "#/errors/ConnectionError";
import { SubscriptionError } from "#/errors/SubscriptionError";
import { makeControlGate } from "#/events/ControlGate";
import { pingEventWire } from "#/events/Heartbeat";
import { makeMailbox } from "#/events/Mailbox";
import { makeEventOwner } from "#/events/Owner";
import type { EventError } from "#/events/Types";
import { forkEventWorker } from "#/events/Worker";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisArgument } from "#/RedisArgument";
import type { RedisConfig } from "#/RedisConfig";
import { subscriptionControl } from "#/subscriptions/Control";
import { eventFrame } from "#/subscriptions/Frames";
import { makeTrackedCache } from "#/tracking/cache/Cache";
import type { CacheOptions } from "#/tracking/cache/Cache";
import { InvalidationState } from "#/tracking/Invalidation";
import type { Invalidation } from "#/tracking/Invalidation";
import { decodeTrackingRuntime } from "#/tracking/Options";
import type { TrackingRuntimeOptions } from "#/tracking/Options";

export const makeRedisTracking = Effect.fnUntraced(function* <R = never>(
  config: RedisConfig,
  options: TrackingRuntimeOptions<R> = {},
) {
  const { runtime, selected, credentials } = yield* decodeTrackingRuntime(options);
  const state = new InvalidationState();
  const budget = { bytes: 0, maximum: runtime.maxBytes * 2 };
  let healthy = false;
  let stopped = false;
  let failure: Cause.Cause<EventError> | undefined;

  const events = yield* makeMailbox<Invalidation>(
    runtime.maxMessages,
    runtime.maxBytes,
    budget,
    () => data.generation(),
  );
  const unknown = yield* makeMailbox<{ readonly generation: number; readonly value: RespValue }>(
    runtime.maxMessages,
    runtime.maxBytes,
    budget,
    () => data.generation(),
  );

  const failed = (cause: Cause.Cause<EventError>, generation: number) => {
    if (failure !== undefined || stopped) return;
    failure = cause;
    healthy = false;
    state.invalidate(null);
    events.offer(() => ({ _tag: "TrackingGap", generation }), 0);
    // Loss of either side invalidates the entire cohort, including an otherwise live data socket.
    data.current()?.retire(cause);
    receiver.current()?.retire(cause);
  };

  const receive = (
    reply: RespValue,
    cost: number,
    generation: number,
    subscriptionArrays: boolean,
  ) =>
    Effect.gen(function* () {
      // Data arrays are replies even when their first element is a Pub/Sub event name.
      if (!subscriptionArrays && undecorate(reply)._tag !== "Push") return false;
      const frame = yield* eventFrame(reply);
      if (frame === undefined) {
        if (!subscriptionArrays || undecorate(reply)._tag !== "Array") return false;
        unknown.offer(() => ({ value: reply, generation }), cost);
        return true;
      }
      if (frame._tag === "Invalidate") {
        state.invalidate(frame.keys);
        events.offer(() => ({ ...frame, generation }), cost);
      } else if (frame._tag === "TrackingLost") {
        return yield* new SubscriptionError({ reason: "tracking-lost", generation });
      } else if (frame._tag !== "Acknowledgment" && frame._tag !== "Pong") {
        unknown.offer(() => ({ value: reply, generation }), cost);
      }
      return true;
    });

  const ownerOptions = credentials === undefined ? {} : { credentials };
  const data = yield* makeEventOwner(
    config,
    ownerOptions,
    (reply, cost, generation) => receive(reply, cost, generation, false),
    failed,
    runtime.maxWaiters,
  );
  const receiver = yield* makeEventOwner(
    config,
    ownerOptions,
    (reply, cost, generation) => receive(reply, cost, generation, true),
    failed,
    runtime.maxWaiters,
  );

  const locked = yield* makeControlGate(
    runtime.maxWaiters,
    config.commandTimeoutMillis,
    data.generation,
  );

  const ensure = Effect.gen(function* () {
    if (stopped)
      return yield* new SubscriptionError({ reason: "closed", generation: data.generation() });
    if (failure !== undefined) {
      if (Cause.hasDies(failure)) return yield* Effect.failCause(failure);
      return yield* new ConnectionError({
        reason: "unavailable",
        generation: data.generation(),
        delivery: "unsent",
        cause: Redacted.make(failure),
      });
    }
    if (healthy) return;

    yield* Effect.gen(function* () {
      const wire = yield* data.open;
      let redirect: bigint | undefined;
      if (wire.protocol === "resp2" || runtime.delivery === "redirect") {
        const invalidations = yield* receiver.open;
        redirect = yield* invalidations
          .request(["CLIENT", "ID"])
          .pipe(Effect.flatMap(checkServerReply), Effect.flatMap(integer));
        if (invalidations.protocol === "resp2")
          yield* subscriptionControl(invalidations, "subscribe", [
            new TextEncoder().encode("__redis__:invalidate"),
          ]);
      }

      const tokens = yield* trackingTokens(true, {
        ...selected,
        ...(redirect === undefined ? {} : { redirect }),
      });
      yield* wire
        .request(tokens)
        .pipe(Effect.flatMap(checkServerReply), Effect.flatMap(status("OK")));
      if (failure !== undefined) return yield* Effect.failCause(failure);

      healthy = true;
      events.offer(() => ({ _tag: "TrackingReady", generation: wire.id }), 0);
    }).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (exit._tag === "Failure") failed(exit.cause, data.generation());
        }),
      ),
    );
  });

  const start = locked(ensure);

  const run = Effect.fnUntraced(function* <A, E, RD>(
    prepared: PreparedCommand<A, E, RD>,
    caching?: "YES" | "NO",
  ) {
    if (
      prepared.metadata.execution !== "ordinary" ||
      prepared.routing._tag === "Node" ||
      checkOrdinary(prepared.tokens) !== undefined
    )
      return yield* new SubscriptionError({
        reason: "unsupported-command",
        generation: data.generation(),
      });

    let armed = false;
    const reply = yield* locked(
      Effect.gen(function* () {
        yield* ensure;
        const wire = data.current();
        if (wire === undefined) return yield* Effect.die("Missing ready tracking connection");

        const routing = prepared.routing;
        const writes =
          routing._tag === "Keys" || routing._tag === "Dynamic"
            ? routing.keys.filter((key) => key.access !== "read")
            : [];
        if (routing._tag === "Keyless" || writes.length > 0) {
          const keys = writes
            .map((key) => prepared.tokens[key.index])
            .filter((key) => key !== undefined)
            .map((key) => (typeof key === "string" ? new TextEncoder().encode(key) : key));
          state.invalidate(routing._tag === "Keyless" || routing._tag === "Dynamic" ? null : keys);
        }

        // The prefix and its target remain inside this exclusive operation, including both replies.
        if (caching !== undefined) {
          armed = true;
          yield* wire
            .request(["CLIENT", "CACHING", caching])
            .pipe(Effect.flatMap(checkServerReply), Effect.flatMap(status("OK")));
        }
        const response = yield* wire.request(prepared.tokens);
        armed = false;
        return response;
      }).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            // A canceled prefix must not arm an unrelated request after this mutex releases.
            if (exit._tag === "Failure" && armed) data.current()?.retire(exit.cause);
          }),
        ),
      ),
    );

    return yield* decodeReply(prepared, reply);
  });

  const execute = <A, E, RD, RE>(command: Command<A, E, RD, RE>) =>
    command.prepare.pipe(Effect.flatMap((prepared) => run(prepared)));
  const read = (key: RedisArgument) =>
    getBytes(key).prepare.pipe(
      Effect.flatMap((prepared) => run(prepared, selected.mode === "optin" ? "YES" : undefined)),
    );

  yield* forkEventWorker(
    Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(runtime.heartbeatMillis);
        yield* locked(
          Effect.gen(function* () {
            if (!healthy) return;
            for (const owner of [data, receiver]) {
              const wire = owner.current();
              if (wire === undefined) continue;
              yield* pingEventWire(wire);
            }
          }),
        ).pipe(
          Effect.catch((error) => {
            // A heartbeat that cannot enter the foreground lane has not tested socket liveness.
            if (
              (error._tag === "SubscriptionError" && error.reason === "capacity") ||
              (error._tag === "ConnectionError" && error.delivery === "unsent")
            )
              return Effect.void;
            return Effect.sync(() => failed(Cause.fail(error), data.generation()));
          }),
        );
      }
    }),
    (cause) => {
      failed(cause, data.generation());
      if (Cause.hasDies(cause)) stopped = true;
    },
  );

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      stopped = true;
      healthy = false;
      state.invalidate(null);
      events.fail(
        Cause.fail(new SubscriptionError({ reason: "closed", generation: data.generation() })),
      );
    }),
  );

  return {
    start,
    execute,
    getBytes: read,
    caching: <A, E, RD, RE>(mode: "YES" | "NO", command: Command<A, E, RD, RE>) =>
      parse(Schema.Literals(["YES", "NO"]), mode).pipe(
        Effect.andThen(command.prepare),
        Effect.flatMap((prepared) => run(prepared, mode)),
      ),
    trackingInfo: () =>
      locked(
        ensure.pipe(
          Effect.andThen(
            Effect.suspend(() => {
              const wire = data.current();
              return wire === undefined
                ? Effect.die("Missing tracking wire")
                : wire.request(["CLIENT", "TRACKINGINFO"]);
            }),
          ),
        ),
      ).pipe(Effect.flatMap(checkServerReply), Effect.flatMap(trackingInfo)),
    restart: locked(
      Effect.gen(function* () {
        healthy = false;
        state.invalidate(null);
        yield* data.release;
        yield* receiver.release;
        failure = undefined;
        yield* ensure;
      }),
    ),
    events: Stream.unwrap(start.pipe(Effect.as(events.stream))),
    invalidations: Stream.unwrap(start.pipe(Effect.as(events.stream))).pipe(
      Stream.filter((event) => event._tag !== "TrackingReady"),
      Stream.mapEffect((event) =>
        event._tag === "TrackingGap"
          ? Effect.fail(
              new SubscriptionError({ reason: "tracking-lost", generation: event.generation }),
            )
          : Effect.succeed(event),
      ),
    ),
    unknownPushes: unknown.stream,
    cache: (cacheOptions?: CacheOptions) =>
      makeTrackedCache(
        {
          state,
          ready: Effect.suspend(() => (healthy ? Effect.void : start)),
          healthy: () => healthy,
          generation: data.generation,
          load: read,
          eligible: (key) =>
            selected.mode !== "broadcast" ||
            selected.prefixes === undefined ||
            selected.prefixes.length === 0 ||
            selected.prefixes.some((prefix) => {
              const bytes = typeof prefix === "string" ? new TextEncoder().encode(prefix) : prefix;
              return (
                bytes.length <= key.length && bytes.every((byte, index) => key[index] === byte)
              );
            }),
        },
        cacheOptions,
      ),
    snapshot: Effect.sync(() => ({
      healthy,
      generation: data.generation(),
      redirected: receiver.current() !== undefined,
      retainedBytes: budget.bytes,
    })),
  };
});

export type RedisTrackingClient = Effect.Success<ReturnType<typeof makeRedisTracking>>;

export class RedisTracking extends Context.Service<RedisTracking, RedisTrackingClient>()(
  "@envoy1084/effect-redis/RedisTracking",
) {
  static layer<R = never>(config: RedisConfig, options?: TrackingRuntimeOptions<R>) {
    return Layer.effect(RedisTracking, makeRedisTracking(config, options));
  }
}
