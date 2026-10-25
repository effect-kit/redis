import { Cause, Effect, Exit, Redacted } from "effect";

import type { Command } from "#/command/Command";
import { checkServerReply } from "#/command/Decode";
import { status } from "#/command/reply/Scalars";
import { AdmissionError } from "#/errors/AdmissionError";
import { BatchError } from "#/errors/BatchError";
import { ConnectionError } from "#/errors/ConnectionError";
import { ProtocolError } from "#/errors/ProtocolError";
import { mapBatchFailure } from "#/sessions/batch/Failure";
import { prepareBatch } from "#/sessions/batch/Prepare";
import type { AnyCommand, PartialBatchError } from "#/sessions/batch/Types";
import type { SessionPolicy } from "#/sessions/pool/Options";
import type { SessionWire } from "#/sessions/pool/Wire";
import type { SessionState } from "#/sessions/transaction/State";
import type { SessionValidation } from "#/sessions/Validation";

export const replyModeControls = (
  wire: SessionWire,
  state: SessionState,
  policy: SessionPolicy,
  validation?: SessionValidation,
) => {
  const suppress = <Cs extends ReadonlyArray<AnyCommand>>(mode: "OFF" | "SKIP", commands: Cs) =>
    state.run(() =>
      Effect.gen(function* () {
        const prepared = yield* prepareBatch(commands, policy.maxBatchCommands);
        if (validation !== undefined) yield* validation.batch(prepared, false);
        const before = state.get();
        const failure = (error: unknown) => {
          const unsent =
            error instanceof AdmissionError ||
            (error instanceof ProtocolError && error.stage === "encode") ||
            (error instanceof ConnectionError && error.delivery === "unsent");
          return new BatchError({
            phase: "pipeline",
            execution: unsent ? "not-executed" : "partial-or-unknown",
            outcomes: Redacted.make(
              prepared.map((_, index) => ({
                _tag: unsent ? "Unsent" : "Unknown",
                index,
                error: Redacted.make(error),
              })),
            ),
          }) as PartialBatchError<Cs>;
        };
        state.set("uncertain");

        // Only REPLY ON owns a slot. A rejected OFF can still be followed by executed mutations.
        yield* mapBatchFailure(
          wire
            .fence([
              ["CLIENT", "REPLY", mode],
              ...prepared.map((command) => command.tokens),
              ["CLIENT", "REPLY", "ON"],
            ])
            .pipe(Effect.flatMap(checkServerReply), Effect.flatMap(status("OK"))),
          failure,
        ).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit) && (Cause.hasInterrupts(exit.cause) || Cause.hasDies(exit.cause))
              ? Effect.fail(failure(exit.cause))
              : Effect.void,
          ),
        );
        state.set(before);
      }),
    );

  return {
    /** Intentionally suppresses individual successes/errors; completion observes only the ON fence. */
    withoutReplies: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      suppress("OFF", commands),
    skipReply: <A, E, RD, RE>(command: Command<A, E, RD, RE>) =>
      suppress("SKIP", [command] as const),
  };
};
