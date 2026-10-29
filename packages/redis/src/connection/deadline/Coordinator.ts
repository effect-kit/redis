import { Cause, Clock, Duration, Effect, Exit, Queue, Scope } from "effect";

import { DeadlineHeap } from "#/connection/deadline/Heap";

/** One scoped wake covers bounded request registrations; completion only removes its entry. */
export const makeDeadlines = Effect.fnUntraced(function* (
  scope: Scope.Scope,
  capacity: number,
  onDefect: (cause: Cause.Cause<never>) => void,
) {
  const clock = yield* Clock.Clock;
  const wake = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" });
  const heap = new DeadlineHeap();
  const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000;
  let armedAt = Number.POSITIVE_INFINITY;
  let order = 0;
  let closed = false;

  const worker = Effect.gen(function* () {
    while (true) {
      const first = heap.peek();
      if (first === undefined) {
        armedAt = Number.POSITIVE_INFINITY;
        yield* Queue.take(wake);
        continue;
      }

      const delay = Math.min(86_400_000, Math.max(0, first.at - now()));
      armedAt = now() + delay;
      if (delay > 0) yield* Effect.raceFirst(clock.sleep(Duration.millis(delay)), Queue.take(wake));

      armedAt = Number.POSITIVE_INFINITY;
      yield* Effect.sync(() => {
        const timestamp = now();
        while (true) {
          const deadline = heap.peek();
          if (deadline === undefined || deadline.at > timestamp) return;
          heap.remove(deadline);
          deadline.expire();
        }
      });
    }
  }).pipe(
    Effect.onExit((exit) =>
      Exit.isFailure(exit) && Cause.hasDies(exit.cause)
        ? Effect.sync(() =>
            onDefect(Cause.fromReasons(exit.cause.reasons.filter(Cause.isDieReason))),
          )
        : Effect.void,
    ),
  );

  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      closed = true;
      heap.clear();
    }),
  );
  yield* Effect.forkIn(worker, scope);

  return {
    clock,
    size: () => heap.size,
    schedule: (delayMillis: number, expire: () => void) => {
      if (closed || heap.size >= capacity) throw new Error("Deadline owner capacity/lifetime");
      const deadline = { at: now() + delayMillis, order: order++, expire, index: -1 };
      heap.add(deadline);
      // Keep an earlier armed wake after removals/brief idle periods. Re-arming on
      // each successful command would recreate the timer churn this owner avoids.
      if (deadline.at < armedAt) Queue.offerUnsafe(wake, undefined);
      return () => heap.remove(deadline);
    },
  };
});
