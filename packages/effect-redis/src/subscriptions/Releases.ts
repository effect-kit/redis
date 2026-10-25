import { Cause, Deferred, Effect, Exit, Queue, Scope } from "effect";

import { SubscriptionError } from "#/errors/SubscriptionError";
import type { EventError } from "#/events/Types";
import type { EventWire } from "#/events/Wire";
import { subscriptionControl } from "#/subscriptions/Control";
import { unsubscribeKind } from "#/subscriptions/Frames";
import type { Interest, Listener } from "#/subscriptions/Interests";

/** One supervisor owns unsubscribe receipts, including releases racing background retirement. */
export const makeSubscriptionReleases = (state: {
  readonly interests: Map<string, Interest>;
  readonly listeners: Set<Listener>;
  readonly wake: Queue.Queue<void>;
  readonly current: () => EventWire | undefined;
  readonly generation: () => number;
}) => {
  const retiring = new Set<Listener>();
  let cleanupFailure: Cause.Cause<EventError> | undefined;

  const fail = (listener: Listener, cause: Cause.Cause<EventError>) => {
    listener.closed = true;
    listener.mailbox.fail(cause);
    state.listeners.delete(listener);
    for (const interest of listener.interests) interest.listeners.delete(listener);
    retiring.add(listener);
    Queue.offerUnsafe(state.wake, undefined);
  };

  const failReceipts = (cause: Cause.Cause<EventError>) => {
    for (const listener of retiring)
      Deferred.doneUnsafe(listener.released, Effect.failCause(cause));
  };

  const prune = Effect.gen(function* () {
    for (const [key, interest] of state.interests) {
      if (interest.listeners.size > 0) continue;
      const wire = state.current();
      if (interest.active && wire?.isReady())
        yield* subscriptionControl(wire, unsubscribeKind(interest.mode), [interest.target]).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              // A rejected cleanup must not leave an unowned server subscription alive.
              if (exit._tag === "Failure") wire.retire(exit.cause);
            }),
          ),
        );
      state.interests.delete(key);
    }

    for (const listener of retiring) {
      retiring.delete(listener);
      Deferred.doneUnsafe(listener.released, Effect.void);
      yield* Scope.close(listener.scope, Exit.void);
    }
  }).pipe(
    Effect.onExit((exit) =>
      Effect.sync(() => {
        if (exit._tag === "Failure") {
          cleanupFailure = exit.cause;
          failReceipts(exit.cause);
        }
      }),
    ),
  );

  const request = (listener: Listener) =>
    Effect.sync(() => {
      if (listener.closed) return;
      listener.closed = true;
      state.listeners.delete(listener);
      listener.mailbox.fail(Cause.fail(Cause.Done()));
      if (listener.interests.length === 0) {
        Deferred.doneUnsafe(listener.released, Effect.void);
        return;
      }

      retiring.add(listener);
      for (const interest of listener.interests) interest.listeners.delete(listener);
      Queue.offerUnsafe(state.wake, undefined);
    });

  return {
    fail,
    prune,
    count: () => retiring.size,
    remove: (listener: Listener) =>
      Effect.suspend(() =>
        listener.closed
          ? Effect.void
          : request(listener).pipe(Effect.andThen(Deferred.await(listener.released))),
      ),
    close: (listener: Listener) =>
      request(listener).pipe(
        Effect.andThen(Deferred.await(listener.released)),
        Effect.onExit(() => Scope.close(listener.scope, Exit.void)),
      ),
    poison: (cause: Cause.Cause<EventError>, record: boolean) => {
      if (record) cleanupFailure = cause;
      for (const listener of state.listeners) fail(listener, cause);
      failReceipts(cause);
    },
    finish: Effect.gen(function* () {
      const cause = Cause.fail(
        new SubscriptionError({ reason: "closed", generation: state.generation() }),
      );
      for (const listener of state.listeners) fail(listener, cause);
      for (const listener of retiring) {
        retiring.delete(listener);
        Deferred.doneUnsafe(listener.released, Effect.failCause(cause));
        yield* Scope.close(listener.scope, Exit.void);
      }
      if (
        cleanupFailure !== undefined &&
        (!Cause.hasInterrupts(cleanupFailure) || Cause.hasDies(cleanupFailure))
      )
        return yield* Effect.orDie(Effect.failCause(cleanupFailure));
    }),
  };
};
