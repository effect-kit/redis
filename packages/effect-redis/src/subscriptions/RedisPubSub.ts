import {
  Cause,
  Context,
  Effect,
  Exit,
  Layer,
  Queue,
  Schedule,
  Schema,
  Scope,
  Stream,
} from "effect";

import { undecorate } from "#/command/reply/Scalars";
import { Arguments, parse } from "#/commands/internal/Input";
import { SubscriptionError } from "#/errors/SubscriptionError";
import { makeControlGate } from "#/events/ControlGate";
import { pingEventWire } from "#/events/Heartbeat";
import { makeMailbox } from "#/events/Mailbox";
import { makeEventOwner } from "#/events/Owner";
import type { EventError } from "#/events/Types";
import { forkEventWorker } from "#/events/Worker";
import { encodeCommand } from "#/protocol/encode";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisArgument } from "#/RedisArgument";
import type { RedisConfig } from "#/RedisConfig";
import { subscriptionControl } from "#/subscriptions/Control";
import {
  acknowledgmentModes,
  byteIdentity,
  eventFrame,
  subscribeKind,
  unsubscribeKind,
} from "#/subscriptions/Frames";
import { copyMessage, interestId, messageMatches } from "#/subscriptions/Interests";
import type { Interest, Listener } from "#/subscriptions/Interests";
import { decodeSubscriptionPolicy } from "#/subscriptions/Options";
import type { SubscriptionOptions } from "#/subscriptions/Options";
import type { PubSubMessage, SubscribeOptions, SubscriptionEvent } from "#/subscriptions/Types";

const Selection = Schema.Struct({
  mode: Schema.optionalKey(Schema.Literals(["channel", "pattern", "shard"])),
  recovery: Schema.optionalKey(Schema.Literals(["fail", "resubscribe"])),
});

export const makeRedisPubSub = Effect.fnUntraced(function* <R = never>(
  config: RedisConfig,
  options: SubscriptionOptions<R> = {},
) {
  const { credentials, ...input } = options;
  const policy = yield* decodeSubscriptionPolicy(input);
  const wake = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" });
  const interests = new Map<string, Interest>();
  const listeners = new Set<Listener>();
  const retiring = new Set<Listener>();
  const budget = { bytes: 0, maximum: policy.maxRetainedBytes };
  let stopped = false;

  const unknown = yield* makeMailbox<{
    readonly generation: number;
    readonly value: RespValue;
  }>(policy.maxMessages, policy.maxBytes, budget, () => owner.generation());

  const failListener = (listener: Listener, cause: Cause.Cause<EventError>) => {
    listener.closed = true;
    retiring.add(listener);
    listener.mailbox.fail(cause);
    listeners.delete(listener);
    for (const interest of interests.values()) interest.listeners.delete(listener);
    if (!stopped) Queue.offerUnsafe(wake, undefined);
  };

  const failed = (cause: Cause.Cause<EventError>, generation: number) => {
    for (const interest of interests.values()) interest.active = false;
    for (const listener of listeners) {
      listener.ready = false;
      if (
        !stopped &&
        listener.recovery === "resubscribe" &&
        !Cause.hasDies(cause) &&
        !Cause.hasInterrupts(cause)
      ) {
        if (!listener.mailbox.offer(() => ({ _tag: "DeliveryGap", generation }), 0))
          failListener(
            listener,
            Cause.fail(new SubscriptionError({ reason: "overflow", generation })),
          );
      } else failListener(listener, cause);
    }
    if (!stopped) Queue.offerUnsafe(wake, undefined);
  };

  const owner = yield* makeEventOwner(
    config,
    credentials === undefined ? {} : { credentials },
    (reply, cost, generation) =>
      Effect.gen(function* () {
        const frame = yield* eventFrame(reply);
        if (frame === undefined) {
          // This socket has no ordinary array-returning operations; preserve future RESP2 events.
          if (undecorate(reply)._tag !== "Array") return false;
          unknown.offer(() => ({ generation, value: reply }), cost);
          return true;
        }

        if (frame._tag === "Acknowledgment") {
          if (frame.target.length > policy.maxInterestBytes)
            return yield* new SubscriptionError({ reason: "invalid-frame", generation });
          const mode = acknowledgmentModes[frame.kind];
          if (mode !== undefined) {
            const interest = interests.get(interestId(mode, frame.target));
            if (interest !== undefined) interest.active = frame.kind === subscribeKind(mode);
          }
          for (const listener of listeners) {
            if (!listener.ready && listener.interests.every((interest) => interest.active)) {
              listener.ready = true;
              if (!listener.mailbox.offer(() => ({ _tag: "Ready", generation }), 0))
                failListener(
                  listener,
                  Cause.fail(new SubscriptionError({ reason: "overflow", generation })),
                );
            }
          }
        } else if (
          frame._tag === "Message" ||
          frame._tag === "PatternMessage" ||
          frame._tag === "ShardMessage"
        ) {
          for (const interest of interests.values()) {
            if (!messageMatches(interest, frame)) continue;
            for (const listener of interest.listeners) {
              if (!listener.mailbox.offer(() => copyMessage(frame, generation), cost))
                failListener(
                  listener,
                  Cause.fail(new SubscriptionError({ reason: "overflow", generation })),
                );
            }
          }
        } else if (frame._tag === "UnknownPush")
          unknown.offer(() => ({ generation, value: frame.value }), cost);
        else if (frame._tag !== "Pong") unknown.offer(() => ({ generation, value: reply }), cost);

        return true;
      }),
    failed,
    policy.maxWaiters,
  );

  const locked = yield* makeControlGate(
    policy.maxWaiters,
    config.commandTimeoutMillis,
    owner.generation,
  );

  const restore = Effect.gen(function* () {
    const wire = yield* owner.open;
    for (const interest of interests.values()) {
      if (interest.listeners.size === 0) {
        interests.delete(interestId(interest.mode, interest.target));
        continue;
      }
      if (!interest.active)
        yield* subscriptionControl(wire, subscribeKind(interest.mode), [interest.target]);
    }
    return wire;
  });

  const prune = Effect.gen(function* () {
    for (const [key, interest] of interests) {
      if (interest.listeners.size > 0) continue;
      const wire = owner.current();
      if (interest.active && wire?.isReady())
        yield* subscriptionControl(wire, unsubscribeKind(interest.mode), [interest.target]);
      interests.delete(key);
    }
    for (const listener of retiring) {
      retiring.delete(listener);
      yield* Scope.close(listener.scope, Exit.void);
    }
  });

  const remove = (listener: Listener) =>
    Effect.suspend(() => {
      if (listener.closed) return Effect.void;
      listener.closed = true;
      listeners.delete(listener);
      listener.mailbox.fail(Cause.fail(Cause.Done()));
      if (listener.interests.length === 0) return Effect.void;

      retiring.add(listener);
      for (const interest of listener.interests) interest.listeners.delete(listener);
      Queue.offerUnsafe(wake, undefined);
      // One release per listener plus one supervisor has reserved, bounded control admission.
      return locked(prune, true);
    });

  const acquire = Effect.fnUntraced(function* (
    targets: readonly [RedisArgument, ...RedisArgument[]],
    selection: SubscribeOptions,
    scope: Scope.Closeable,
  ) {
    const selected = yield* parse(Selection, selection);
    const values = yield* parse(Arguments, targets);
    const mode = selected.mode ?? "channel";
    yield* Effect.fromResult(
      encodeCommand([subscribeKind(mode), ...values], {
        ...config.limits,
        maxQueuedBytes: Math.min(config.limits.maxQueuedBytes, policy.maxInterestBytes),
      }),
    );
    const unique = new Map<string, Uint8Array>();
    for (const value of values) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value.slice();
      unique.set(byteIdentity(bytes), bytes);
    }
    const mailbox = yield* makeMailbox<SubscriptionEvent>(
      policy.maxMessages,
      policy.maxBytes,
      budget,
      owner.generation,
    );
    const listener: Listener = {
      scope,
      mode,
      interests: [],
      recovery: selected.recovery ?? "fail",
      mailbox,
      ready: false,
      closed: false,
    };

    yield* Effect.acquireRelease(Effect.succeed(listener), (acquired) =>
      Effect.orDie(remove(acquired)),
    );
    yield* locked(
      Effect.gen(function* () {
        if (stopped)
          return yield* new SubscriptionError({ reason: "closed", generation: owner.generation() });
        const missing = [...unique.values()].filter(
          (target) => !interests.has(interestId(mode, target)),
        );
        const interestBytes = [...interests.values()].reduce(
          (sum, interest) => sum + interest.target.length,
          0,
        );
        if (
          listeners.size + retiring.size >= policy.maxListeners ||
          interests.size + missing.length > policy.maxInterests ||
          interestBytes + missing.reduce((sum, target) => sum + target.length, 0) >
            policy.maxInterestBytes
        )
          return yield* new SubscriptionError({
            reason: "capacity",
            generation: owner.generation(),
          });

        listeners.add(listener);
        for (const target of unique.values()) {
          const key = interestId(mode, target);
          let interest = interests.get(key);
          if (interest === undefined) {
            interest = { id: key, mode, target, active: false, listeners: new Set() };
            interests.set(key, interest);
          }
          interest.listeners.add(listener);
          listener.interests.push(interest);
        }

        yield* restore.pipe(
          Effect.onExit((exit) => {
            if (exit._tag === "Success") return Effect.void;
            return Effect.sync(() => failListener(listener, exit.cause));
          }),
        );
        if (listener.closed)
          return yield* new SubscriptionError({ reason: "closed", generation: owner.generation() });
        if (!listener.ready) {
          listener.ready = true;
          mailbox.offer(() => ({ _tag: "Ready", generation: owner.generation() }), 0);
        }
        return listener;
      }),
    );

    const messages = mailbox.stream.pipe(
      Stream.filter((event) => event._tag !== "Ready"),
      Stream.mapEffect((event): Effect.Effect<PubSubMessage, SubscriptionError> =>
        event._tag === "DeliveryGap"
          ? Effect.fail(
              new SubscriptionError({ reason: "delivery-gap", generation: event.generation }),
            )
          : Effect.succeed(event),
      ),
    );

    return {
      events: mailbox.stream,
      messages,
      close: () => remove(listener).pipe(Effect.onExit(() => Scope.close(scope, Exit.void))),
    };
  });

  const subscribe = Effect.fnUntraced(function* (
    targets: readonly [RedisArgument, ...RedisArgument[]],
    selection: SubscribeOptions = {},
  ) {
    // Manual close releases this child scope too, removing its finalizers from a long-lived caller.
    const scope = yield* Scope.fork(yield* Effect.scope);
    return yield* acquire(targets, selection, scope).pipe(
      Scope.provide(scope),
      Effect.onExit((exit) => (exit._tag === "Failure" ? Scope.close(scope, exit) : Effect.void)),
    );
  });

  const workerFailed = (cause: Cause.Cause<EventError>) => {
    stopped = true;
    for (const listener of listeners) failListener(listener, cause);
    unknown.fail(cause);
  };

  yield* forkEventWorker(
    Effect.gen(function* () {
      while (true) {
        yield* Queue.take(wake);
        yield* locked(
          Effect.gen(function* () {
            yield* prune;
            if (stopped || ![...listeners].some((listener) => listener.recovery === "resubscribe"))
              return;
            const restored = yield* Effect.result(
              restore.pipe(
                Effect.retry({
                  times: policy.reconnectAttempts - 1,
                  schedule: Schedule.spaced(policy.reconnectDelayMillis),
                  while: (error) =>
                    error._tag === "TransportError" || error._tag === "ConnectionError",
                }),
              ),
            );
            if (restored._tag === "Failure") {
              for (const listener of listeners)
                failListener(listener, Cause.fail(restored.failure));
              interests.clear();
            }
          }),
          true,
        );
      }
    }),
    workerFailed,
  );

  yield* forkEventWorker(
    Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(policy.heartbeatMillis);
        yield* locked(
          Effect.gen(function* () {
            const wire = owner.current();
            if (!wire?.isReady()) return;
            yield* pingEventWire(wire);
          }),
        ).pipe(
          Effect.catch((error) => {
            // Foreground admission pressure is not evidence of a dead connection.
            if (
              (error._tag === "SubscriptionError" && error.reason === "capacity") ||
              (error._tag === "ConnectionError" && error.delivery === "unsent")
            )
              return Effect.void;
            return Effect.sync(() => owner.current()?.retire(Cause.fail(error)));
          }),
        );
      }
    }),
    workerFailed,
  );

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      stopped = true;
      failed(
        Cause.fail(new SubscriptionError({ reason: "closed", generation: owner.generation() })),
        owner.generation(),
      );
      for (const listener of retiring) {
        retiring.delete(listener);
        yield* Scope.close(listener.scope, Exit.void);
      }
    }),
  );

  return {
    subscribe,
    psubscribe: (
      patterns: readonly [RedisArgument, ...RedisArgument[]],
      selection?: Omit<SubscribeOptions, "mode">,
    ) => subscribe(patterns, { ...selection, mode: "pattern" }),
    ssubscribe: (
      channels: readonly [RedisArgument, ...RedisArgument[]],
      selection?: Omit<SubscribeOptions, "mode">,
    ) => subscribe(channels, { ...selection, mode: "shard" }),
    unknownPushes: unknown.stream,
    snapshot: Effect.sync(() => ({
      generation: owner.generation(),
      listeners: listeners.size,
      retiring: retiring.size,
      interests: interests.size,
      retainedBytes: budget.bytes,
    })),
  };
});

export type RedisPubSubClient = Effect.Success<ReturnType<typeof makeRedisPubSub>>;

export class RedisPubSub extends Context.Service<RedisPubSub, RedisPubSubClient>()(
  "@envoy1084/effect-redis/RedisPubSub",
) {
  static layer<R = never>(config: RedisConfig, options?: SubscriptionOptions<R>) {
    return Layer.effect(RedisPubSub, makeRedisPubSub(config, options));
  }
}
