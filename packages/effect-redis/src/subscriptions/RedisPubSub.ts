import { Cause, Context, Effect, Layer, Queue, Schedule, Schema, Semaphore, Stream } from "effect";

import { checkServerReply } from "#/command/Decode";
import { status } from "#/command/reply/Scalars";
import { Arguments, parse } from "#/commands/internal/Input";
import { SubscriptionError } from "#/errors/SubscriptionError";
import { makeMailbox } from "#/events/Mailbox";
import { makeEventOwner } from "#/events/Owner";
import type { EventError } from "#/events/Types";
import { forkEventWorker } from "#/events/Worker";
import { encodeCommand } from "#/protocol/encode";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisArgument } from "#/RedisArgument";
import type { RedisConfig } from "#/RedisConfig";
import { subscriptionControl } from "#/subscriptions/Control";
import { byteIdentity, eventFrame, subscribeKind, unsubscribeKind } from "#/subscriptions/Frames";
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
  const mutex = yield* Semaphore.make(1);
  const wake = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" });
  const interests = new Map<string, Interest>();
  const listeners = new Set<Listener>();
  const budget = { bytes: 0, maximum: policy.maxRetainedBytes };
  let stopped = false;
  let waiters = 0;

  const unknown = yield* makeMailbox<{
    readonly generation: number;
    readonly value: RespValue;
  }>(policy.maxMessages, policy.maxBytes, budget, () => owner.generation());

  const failListener = (listener: Listener, cause: Cause.Cause<EventError>) => {
    listener.closed = true;
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
        if (frame === undefined) return false;

        if (frame._tag === "Acknowledgment") {
          for (const interest of interests.values()) {
            if (byteIdentity(interest.target) !== byteIdentity(frame.target)) continue;
            if (frame.kind === subscribeKind(interest.mode)) interest.active = true;
            if (frame.kind === unsubscribeKind(interest.mode)) interest.active = false;
          }
          for (const listener of listeners) {
            if (
              !listener.ready &&
              listener.targets.every(
                (target) => interests.get(interestId(listener.mode, target))?.active,
              )
            ) {
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

  const locked = <A, E, RU>(body: Effect.Effect<A, E, RU>) =>
    Effect.suspend<A, E | SubscriptionError, RU>(() => {
      if (waiters >= policy.maxWaiters)
        return Effect.fail(
          new SubscriptionError({ reason: "capacity", generation: owner.generation() }),
        );
      return Effect.acquireUseRelease(
        Effect.sync(() => {
          waiters++;
        }),
        () => mutex.withPermits(1)(body),
        () =>
          Effect.sync(() => {
            waiters--;
          }),
      );
    });

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
  });

  const remove = (listener: Listener) =>
    locked(
      Effect.gen(function* () {
        listener.closed = true;
        listeners.delete(listener);
        listener.mailbox.fail(Cause.fail(Cause.Done()));

        for (const target of listener.targets) {
          const key = interestId(listener.mode, target);
          const interest = interests.get(key);
          if (interest === undefined) continue;
          interest.listeners.delete(listener);
          if (interest.listeners.size > 0) continue;

          const wire = owner.current();
          if (interest.active && wire?.isReady())
            yield* subscriptionControl(wire, unsubscribeKind(listener.mode), [target]);
          interests.delete(key);
        }
      }),
    );

  const subscribe = Effect.fnUntraced(function* (
    targets: readonly [RedisArgument, ...RedisArgument[]],
    selection: SubscribeOptions = {},
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
      mode,
      targets: [...unique.values()],
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
        const missing = listener.targets.filter(
          (target) => !interests.has(interestId(mode, target)),
        );
        const interestBytes = [...interests.values()].reduce(
          (sum, interest) => sum + interest.target.length,
          0,
        );
        if (
          listeners.size >= policy.maxListeners ||
          interests.size + missing.length > policy.maxInterests ||
          interestBytes + missing.reduce((sum, target) => sum + target.length, 0) >
            policy.maxInterestBytes
        )
          return yield* new SubscriptionError({
            reason: "capacity",
            generation: owner.generation(),
          });

        listeners.add(listener);
        for (const target of listener.targets) {
          const key = interestId(mode, target);
          let interest = interests.get(key);
          if (interest === undefined) {
            interest = { mode, target, active: false, listeners: new Set() };
            interests.set(key, interest);
          }
          interest.listeners.add(listener);
        }
        listener.targets = listener.targets.map(
          (target) => interests.get(interestId(mode, target))?.target ?? target,
        );

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

    return { events: mailbox.stream, messages, close: () => remove(listener) };
  });

  const workerFailed = (cause: Cause.Cause<EventError>) => {
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
            const reply = yield* wire.request(["PING"], (value, handled) =>
              eventFrame(value).pipe(Effect.map((frame) => frame?._tag === "Pong" || !handled)),
            );
            yield* checkServerReply(reply);
            const frame = yield* eventFrame(reply);
            if (frame?._tag !== "Pong") yield* status("PONG")(reply);
          }),
        ).pipe(
          Effect.catch((error) => Effect.sync(() => owner.current()?.retire(Cause.fail(error)))),
        );
      }
    }),
    workerFailed,
  );

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      stopped = true;
      failed(
        Cause.fail(new SubscriptionError({ reason: "closed", generation: owner.generation() })),
        owner.generation(),
      );
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
