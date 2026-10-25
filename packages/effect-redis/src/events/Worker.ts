import { Cause, Effect, Exit, Fiber } from "effect";
import type { Scope } from "effect";

/** Explicit joining preserves defects raised during worker/resource finalization. */
export const forkEventWorker = Effect.fnUntraced(function* <E, R>(
  work: Effect.Effect<unknown, E, R | Scope.Scope>,
  failed: (cause: Cause.Cause<E>) => void,
) {
  const worker = yield* Effect.forkScoped(
    work.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit)) failed(exit.cause);
        }),
      ),
    ),
  );

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* Fiber.interrupt(worker);
      const exit = yield* Fiber.await(worker);
      if (Exit.isFailure(exit)) {
        const defects = exit.cause.reasons.filter(Cause.isDieReason);
        if (defects.length > 0) return yield* Effect.failCause(Cause.fromReasons<never>(defects));
      }
    }),
  );
});
