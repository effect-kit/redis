import { Cause, Effect, Exit, Redacted } from "effect";

import { checkServerReply } from "#/command/Decode";
import { status, undecorate } from "#/command/reply/Scalars";
import { BatchError } from "#/errors/BatchError";
import { ServerError } from "#/errors/ServerError";
import { TransactionError } from "#/errors/TransactionError";
import { mapBatchFailure } from "#/sessions/batch/Failure";
import type {
  AnyCommand,
  BatchOutcomes,
  PartialBatchError,
  PreparedBatch,
} from "#/sessions/batch/Types";
import type { SessionWire, WireOutcome } from "#/sessions/pool/Wire";
import { decodeTransaction } from "#/sessions/transaction/Decode";
import type { SessionState } from "#/sessions/transaction/State";

/** MULTI has already succeeded. Only verified abort semantics permit EXEC to follow the queue. */
export const submitPipelined = <Cs extends ReadonlyArray<AnyCommand>>(
  wire: SessionWire,
  state: SessionState,
  prepared: PreparedBatch<Cs>,
) =>
  Effect.suspend(() => {
    let execMayHaveBeenWritten = false;
    let execReplied = false;
    let queued: ReadonlyArray<WireOutcome> | undefined;

    const failure = (error: unknown) =>
      new BatchError({
        phase: "transaction-exec",
        execution: execMayHaveBeenWritten ? "unknown" : "not-executed",
        outcomes: Redacted.make(
          prepared.map((_, index) => {
            const reply = queued?.[index];
            return reply?._tag === "Replied"
              ? { _tag: "Replied", index, reply: Redacted.make(reply.reply) }
              : {
                  _tag: reply?._tag ?? "Unsent",
                  index,
                  error: Redacted.make(reply?.error ?? error),
                };
          }) as BatchOutcomes<Cs>,
        ),
      }) as PartialBatchError<Cs>;

    return Effect.gen(function* () {
      if (wire.queueAndExec === undefined) return undefined;
      state.set("uncertain");
      const replies = yield* mapBatchFailure(
        wire.queueAndExec(
          prepared.map((command) => command.tokens),
          (written) => {
            execMayHaveBeenWritten = written;
          },
        ),
        (error) =>
          error instanceof BatchError ? (error as PartialBatchError<Cs>) : failure(error),
      );

      if (replies.length === 0) {
        state.set("multi");
        return undefined;
      }

      queued = replies.slice(0, -1);
      const exec = replies.at(-1);
      if (exec === undefined) return yield* Effect.die(new Error("Missing EXEC reply slot"));
      execMayHaveBeenWritten = exec._tag !== "Unsent";
      execReplied = exec._tag === "Replied";
      if (exec._tag !== "Replied") return yield* Effect.fail(failure(exec.error));

      const acknowledgments = yield* Effect.forEach(queued, (reply) =>
        Effect.result(
          Effect.gen(function* () {
            if (reply._tag !== "Replied") return yield* reply.error;
            return yield* checkServerReply(reply.reply).pipe(Effect.flatMap(status("QUEUED")));
          }),
        ),
      );

      if (acknowledgments.some((result) => result._tag === "Failure")) {
        const checked = yield* Effect.result(checkServerReply(exec.reply));
        const aborted =
          checked._tag === "Failure"
            ? checked.failure instanceof ServerError && checked.failure.code === "EXECABORT"
            : undecorate(exec.reply)._tag === "Null";

        // An unexpected backend response cannot justify a nonexecution claim or lease reuse.
        if (aborted) state.set("idle");
        return yield* new TransactionError({
          reason: "queue-rejected",
          execution: aborted ? "not-executed" : "unknown",
          errors: Redacted.make(acknowledgments),
        });
      }

      return yield* decodeTransaction(state, prepared, exec.reply);
    }).pipe(
      Effect.onExit((exit) => {
        if (
          Exit.isSuccess(exit) ||
          execReplied ||
          (!Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause))
        )
          return Effect.void;

        // The wire finalizer knows each queue slot's actual delivery. Do not
        // replace that evidence with guesses when the aggregate await is interrupted.
        const hasEvidence = exit.cause.reasons.some((reason) => {
          const error = Cause.isFailReason(reason)
            ? reason.error
            : Cause.isDieReason(reason)
              ? reason.defect
              : undefined;
          return error instanceof BatchError && error.phase === "transaction-exec";
        });
        return hasEvidence ? Effect.void : Effect.fail(failure(exit.cause));
      }),
    );
  });
