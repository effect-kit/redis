import { Cause, Effect, Exit, Fiber, Queue, Stream } from "effect";
import type { Scope } from "effect";

/** One scoped producer and one buffered entry keep slow consumers bounded. */
export const scopedReader = <A, E, R = never>(
  produce: (queue: Queue.Queue<A, E | Cause.Done>) => Effect.Effect<unknown, E, R | Scope.Scope>,
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const queue = yield* Queue.bounded<A, E | Cause.Done>(1);
      yield* Effect.addFinalizer(() => Queue.shutdown(queue));
      const producer = yield* Effect.forkIn(
        Effect.suspend(() => produce(queue)).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? Queue.failCause(queue, exit.cause) : Queue.end(queue),
          ),
        ),
        scope,
      );
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          // Join explicitly: an interrupted producer may still fail while releasing its physical lease.
          yield* Fiber.interrupt(producer);
          const exit = yield* Fiber.await(producer);
          if (Exit.isSuccess(exit)) return;
          const defects = exit.cause.reasons.filter(Cause.isDieReason);
          if (defects.length > 0) return yield* Effect.failCause(Cause.fromReasons<never>(defects));
        }),
      );
      return Stream.fromQueue(queue);
    }),
  );
