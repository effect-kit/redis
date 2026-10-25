import { Cause, Deferred, Effect, Exit, Fiber, Redacted, Semaphore } from "effect";

import { handshake } from "#/connection/Handshake";
import type { ConnectionOptions } from "#/connection/Options";
import { makeReplyReader } from "#/connection/ReplyReader";
import { ConnectionError } from "#/errors/ConnectionError";
import { HandshakeError } from "#/errors/HandshakeError";
import { SubscriptionError } from "#/errors/SubscriptionError";
import type { EventError } from "#/events/Types";
import { encodeCommand } from "#/protocol/encode";
import type { RedisCommand } from "#/protocol/encode";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisConfig } from "#/RedisConfig";
import { Transport } from "#/transport/Transport";

interface Pending {
  readonly result: Deferred.Deferred<RespValue, EventError>;
  readonly accept: (reply: RespValue, handled: boolean) => Effect.Effect<boolean, EventError>;
}

/** A dedicated event socket: one reader and at most one owned control/reply exchange. */
export const makeEventWire = Effect.fnUntraced(function* <R>(
  config: RedisConfig,
  id: number,
  options: Pick<ConnectionOptions<R>, "credentials">,
  receive: (reply: RespValue, cost: number) => Effect.Effect<boolean, EventError>,
  failed: (cause: Cause.Cause<EventError>) => void,
  maxWaiters: number,
) {
  if (options.credentials !== undefined && config.credentials !== undefined)
    return yield* new HandshakeError({
      stage: "credentials",
      reason: "rejected",
      delivery: "unsent",
    });

  const physical = yield* (yield* Transport).open(config);
  const reader = yield* makeReplyReader(physical, config.limits);
  const mutex = yield* Semaphore.make(1);
  const retired = yield* Deferred.make<void>();
  let pending: Pending | undefined;
  let stopped: Cause.Cause<EventError> | undefined;
  let waiters = 0;

  const retire = (cause: Cause.Cause<EventError>) => {
    if (stopped !== undefined) return;

    stopped = cause;
    reader.dispose();
    if (pending !== undefined) Deferred.doneUnsafe(pending.result, Effect.failCause(cause));
    pending = undefined;
    Deferred.doneUnsafe(retired, Effect.void);
    failed(cause);
  };

  const protocol = yield* handshake(
    physical,
    reader,
    config,
    options.credentials ?? Effect.succeed(config.credentials),
    (reply, cost) =>
      receive(reply, cost).pipe(
        Effect.asVoid,
        Effect.mapError(
          (cause) =>
            new ConnectionError({
              reason: "protocol",
              generation: id,
              delivery: "unsent",
              cause: Redacted.make(cause),
            }),
        ),
      ),
    id,
  ).pipe(
    Effect.timeoutOrElse({
      duration: config.connectTimeoutMillis,
      orElse: () =>
        Effect.fail(
          new HandshakeError({ stage: "timeout", reason: "timeout", delivery: "unsent" }),
        ),
    }),
  );

  const worker = yield* Effect.forkScoped(
    Effect.gen(function* () {
      let turns = 0;
      while (true) {
        const frame = yield* reader.next;
        if (frame === undefined)
          return yield* new ConnectionError({
            reason: "closed",
            generation: id,
            delivery: "possibly-written",
          });

        const handled = yield* receive(frame.value, frame.wireBytes);
        const owner = pending;
        if (owner !== undefined && (yield* owner.accept(frame.value, handled))) {
          pending = undefined;
          Deferred.doneUnsafe(owner.result, Effect.succeed(frame.value));
        } else if (!handled && owner === undefined)
          return yield* new SubscriptionError({ reason: "invalid-frame", generation: id });

        if (++turns % 64 === 0) yield* Effect.yieldNow;
      }
    }).pipe(
      Effect.raceFirst(
        Deferred.await(retired).pipe(
          Effect.andThen(
            Effect.suspend(() => (stopped === undefined ? Effect.void : Effect.failCause(stopped))),
          ),
        ),
      ),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit)) retire(exit.cause);
        }),
      ),
      Effect.ensuring(Effect.orDie(physical.close)),
    ),
  );

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      retire(Cause.fail(new SubscriptionError({ reason: "closed", generation: id })));
      yield* Fiber.interrupt(worker);
      const exit = yield* Fiber.await(worker);
      if (Exit.isFailure(exit)) {
        // Cleanup defects must poison the owner instead of allowing replacement sockets.
        const defects = exit.cause.reasons.filter(Cause.isDieReason);
        if (defects.length > 0) return yield* Effect.failCause(Cause.fromReasons<never>(defects));
      }
    }),
  );

  const request = Effect.fnUntraced(function* (
    command: RedisCommand,
    accept: Pending["accept"] = (_reply, handled) => Effect.succeed(!handled),
  ) {
    if (waiters >= maxWaiters)
      return yield* new SubscriptionError({ reason: "capacity", generation: id });

    return yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        waiters++;
      }),
      () =>
        mutex.withPermits(1)(
          Effect.gen(function* () {
            if (stopped !== undefined) return yield* Effect.failCause(stopped);
            const frame = yield* Effect.fromResult(
              encodeCommand(command, {
                ...config.limits,
                maxQueuedBytes: Math.min(
                  config.limits.maxQueuedBytes,
                  config.limits.maxInFlightBytes,
                ),
              }),
            );
            const result = yield* Deferred.make<RespValue, EventError>();

            return yield* Effect.uninterruptibleMask((restore) => {
              pending = { result, accept };
              // Reply ownership precedes the first byte; cancellation after this point retires the socket.
              return restore(
                physical.write(frame).pipe(Effect.andThen(Deferred.await(result))),
              ).pipe(
                Effect.onExit((exit) =>
                  Effect.sync(() => {
                    if (Exit.isFailure(exit)) retire(exit.cause);
                  }),
                ),
              );
            });
          }),
        ),
      () =>
        Effect.sync(() => {
          waiters--;
        }),
    ).pipe(
      Effect.timeoutOrElse({
        duration: config.commandTimeoutMillis,
        orElse: () => {
          const error = new ConnectionError({
            reason: "timeout",
            generation: id,
            delivery: "possibly-written",
          });
          retire(Cause.fail(error));
          return Effect.fail(error);
        },
      }),
    );
  });

  return { request, protocol, id, retire, isReady: () => stopped === undefined };
});

export type EventWire = Effect.Success<ReturnType<typeof makeEventWire>>;
