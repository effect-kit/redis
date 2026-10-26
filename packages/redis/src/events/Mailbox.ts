import { Cause, Effect, Queue, Stream } from "effect";

import { SubscriptionError } from "#/errors/SubscriptionError";
import type { EventError } from "#/events/Types";

export interface RetainedBudget {
  bytes: number;
  readonly maximum: number;
}

/** Dispatch never waits for user code. Queue and byte accounting share synchronous transitions. */
export const makeMailbox = Effect.fnUntraced(function* <A>(
  maxMessages: number,
  maxBytes: number,
  budget: RetainedBudget,
  generation: () => number,
) {
  const queue = yield* Queue.make<
    { readonly value: A; readonly cost: number },
    EventError | Cause.Done
  >({
    capacity: maxMessages,
    strategy: "dropping",
  });
  let bytes = 0;
  let ended = false;
  let consuming = false;

  const fail = (cause: Cause.Cause<EventError | Cause.Done>) => {
    if (ended) return;

    ended = true;
    budget.bytes -= bytes;
    bytes = 0;
    Queue.failCauseUnsafe(queue, cause);
    Queue.shutdownUnsafe(queue);
  };

  const offer = (make: () => A, cost: number) => {
    if (ended) return false;
    if (cost > maxBytes - bytes || cost > budget.maximum - budget.bytes) {
      fail(Cause.fail(new SubscriptionError({ reason: "overflow", generation: generation() })));
      return false;
    }

    if (!Queue.offerUnsafe(queue, { value: make(), cost })) {
      fail(Cause.fail(new SubscriptionError({ reason: "overflow", generation: generation() })));
      return false;
    }

    bytes += cost;
    budget.bytes += cost;
    return true;
  };

  const stream = Stream.unwrap(
    Effect.acquireRelease(
      Effect.suspend(() => {
        if (consuming)
          return Effect.fail(
            new SubscriptionError({ reason: "concurrent-consumer", generation: generation() }),
          );
        consuming = true;
        return Effect.succeed(queue);
      }),
      () =>
        Effect.sync(() => {
          consuming = false;
        }),
    ).pipe(
      Effect.map((source) =>
        Stream.fromQueue(source).pipe(
          Stream.mapEffect(({ value, cost }) =>
            Effect.sync(() => {
              // A failure may already have discarded queued accounting while a chunk was in flight.
              if (!ended) {
                bytes -= cost;
                budget.bytes -= cost;
              }
              return value;
            }),
          ),
        ),
      ),
    ),
  );

  yield* Effect.addFinalizer(() => Effect.sync(() => fail(Cause.fail(Cause.Done()))));

  return { offer, fail, stream, isOpen: () => !ended, bytes: () => bytes };
});

export type Mailbox<A> = Effect.Success<ReturnType<typeof makeMailbox<A>>>;
