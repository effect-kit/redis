import { Effect, Semaphore } from "effect";

import { ConnectionError } from "#/errors/ConnectionError";
import { SubscriptionError } from "#/errors/SubscriptionError";

/** Limits waiting owners and the whole operation, including setup and multi-command controls. */
export const makeControlGate = Effect.fnUntraced(function* (
  maxWaiters: number,
  timeoutMillis: number,
  generation: () => number,
) {
  const semaphore = yield* Semaphore.make(1);
  let waiters = 0;

  return <A, E, R>(body: Effect.Effect<A, E, R>, reserved = false) =>
    Effect.suspend<A, E | SubscriptionError | ConnectionError, R>(() => {
      if (waiters >= maxWaiters && !reserved)
        return Effect.fail(new SubscriptionError({ reason: "capacity", generation: generation() }));

      let entered = false;
      return Effect.acquireUseRelease(
        Effect.sync(() => {
          waiters++;
        }),
        () =>
          semaphore.withPermits(1)(
            Effect.sync(() => {
              entered = true;
            }).pipe(Effect.andThen(body)),
          ),
        () =>
          Effect.sync(() => {
            waiters--;
          }),
      ).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMillis,
          orElse: () =>
            Effect.fail(
              new ConnectionError({
                reason: "timeout",
                generation: generation(),
                delivery: entered ? "possibly-written" : "unsent",
              }),
            ),
        }),
      );
    });
});
