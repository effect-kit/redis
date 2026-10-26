import { Cause, Effect, Exit, Redacted } from "effect";

import { status } from "#/command/reply/Scalars";
import { SessionError } from "#/errors/SessionError";
import { exchange } from "#/sessions/controls/Exchange";
import type { SessionWire } from "#/sessions/pool/Wire";

export type SessionMode = "idle" | "watched" | "multi" | "uncertain" | "closed";

export const makeSessionState = (wire: SessionWire, cleanupTimeoutMillis: number) => {
  let mode: SessionMode = "idle";
  let active = true;
  let busy = false;
  let transactionActive = false;

  const reset = Effect.gen(function* () {
    if (mode === "closed" || mode === "idle") return;
    if (!wire.isReady() || mode === "uncertain") {
      wire.retire();
      mode = "closed";
      return;
    }

    const command = mode === "multi" ? "DISCARD" : "UNWATCH";
    mode = "uncertain";
    const result = yield* Effect.result(
      exchange(wire, [command], status("OK"), cleanupTimeoutMillis),
    );
    if (result._tag === "Failure") {
      wire.retire();
      mode = "closed";
      return yield* new SessionError({
        reason: "cleanup",
        delivery: "possibly-written",
        cause: Redacted.make(result.failure),
      });
    }
    mode = "idle";
  });

  const run = <A, E, R>(body: () => Effect.Effect<A, E, R>, transaction = false) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (!active || mode === "closed" || !wire.isReady())
          return yield* new SessionError({ reason: "closed", delivery: "unsent" });
        if (busy)
          return yield* new SessionError({
            reason: transactionActive ? "transaction-active" : "busy",
            delivery: "unsent",
          });
        if (mode === "multi" || mode === "uncertain")
          return yield* new SessionError({ reason: "invalid-state", delivery: "unsent" });

        busy = true;
        transactionActive = transaction;

        return yield* restore(Effect.suspend(body)).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (
                Exit.isFailure(exit) &&
                (Cause.hasInterrupts(exit.cause) || Cause.hasDies(exit.cause))
              ) {
                mode = "closed";
                wire.retire();
              }
              busy = false;
              transactionActive = false;
            }),
          ),
        );
      }),
    );

  const finish = Effect.uninterruptible(
    Effect.suspend(() => {
      active = false;
      if (busy) {
        mode = "closed";
        wire.retire();
        return Effect.void;
      }
      return reset;
    }),
  );

  return {
    run,
    reset,
    finish,
    get: () => mode,
    set: (next: SessionMode) => {
      mode = next;
    },
  };
};

export type SessionState = ReturnType<typeof makeSessionState>;
