import { Cause, Effect, Exit, Redacted } from "effect";

import { checkServerReply } from "#/command/Decode";
import { status, undecorate, mismatch } from "#/command/reply/Scalars";
import { AdmissionError } from "#/errors/AdmissionError";
import { BatchError } from "#/errors/BatchError";
import { ConnectionError } from "#/errors/ConnectionError";
import { ProtocolError } from "#/errors/ProtocolError";
import { ServerError } from "#/errors/ServerError";
import { TransactionError } from "#/errors/TransactionError";
import { decodeBatch } from "#/sessions/batch/Decode";
import { mapBatchFailure } from "#/sessions/batch/Failure";
import { unknownBatch } from "#/sessions/batch/Pipeline";
import type {
  AnyCommand,
  BatchOutcomes,
  PartialBatchError,
  PreparedBatch,
  TransactionOutcome,
} from "#/sessions/batch/Types";
import { exchange } from "#/sessions/controls/Exchange";
import type { SessionWire, WireOutcome } from "#/sessions/pool/Wire";
import type { SessionState } from "#/sessions/transaction/State";

export const runTransaction = <Cs extends ReadonlyArray<AnyCommand>>(
  wire: SessionWire,
  state: SessionState,
  prepared: PreparedBatch<Cs>,
) =>
  Effect.suspend(() => {
    let queueStarted = false;
    let queueReplies: ReadonlyArray<WireOutcome> | undefined;
    let execStarted = false;
    let execReplied = false;
    let execMayHaveBeenWritten = false;

    const notExecuted = (error: unknown, phase: "transaction-queue" | "transaction-exec") =>
      new BatchError({
        phase,
        execution: "not-executed",
        outcomes: Redacted.make(
          queueReplies === undefined
            ? prepared.map((_, index) => ({ _tag: "Unsent", index, error: Redacted.make(error) }))
            : queueReplies.map((reply, index) =>
                reply._tag === "Replied"
                  ? { _tag: "Replied", index, reply: Redacted.make(reply.reply) }
                  : { _tag: reply._tag, index, error: Redacted.make(reply.error) },
              ),
        ),
      }) as PartialBatchError<Cs>;

    return Effect.gen(function* () {
      state.set("uncertain");
      // A rejected MULTI must never let the intended transaction's mutations execute as ordinary commands.
      yield* exchange(wire, ["MULTI"], status("OK"));
      state.set("multi");

      queueStarted = true;
      const queued = yield* mapBatchFailure(
        wire.batch(
          prepared.map((command) => command.tokens),
          undefined,
          "transaction-queue",
        ),
        (error) =>
          error instanceof BatchError
            ? (error as PartialBatchError<Cs>)
            : (new BatchError({
                phase: "transaction-queue",
                execution: "not-executed",
                outcomes: Redacted.make(
                  prepared.map((_, index) => ({
                    _tag: "Unsent",
                    index,
                    error: Redacted.make(error),
                  })),
                ),
              }) as PartialBatchError<Cs>),
      );
      queueReplies = queued;
      if (queued.some((reply) => reply._tag !== "Replied"))
        return yield* Effect.fail(
          new BatchError({
            phase: "transaction-queue",
            execution: "not-executed",
            outcomes: Redacted.make(
              queued.map((reply, index) =>
                reply._tag === "Replied"
                  ? { _tag: "Replied", index, reply: Redacted.make(reply.reply) }
                  : { _tag: reply._tag, index, error: Redacted.make(reply.error) },
              ),
            ) as Redacted.Redacted<BatchOutcomes<Cs>>,
          }) as PartialBatchError<Cs>,
        );

      const acknowledgments = yield* Effect.forEach(queued, (reply) =>
        reply._tag === "Replied"
          ? Effect.result(checkServerReply(reply.reply).pipe(Effect.flatMap(status("QUEUED"))))
          : Effect.die(new Error("Missing transaction queue reply")),
      );
      if (acknowledgments.some((result) => result._tag === "Failure"))
        return yield* new TransactionError({
          reason: "queue-rejected",
          execution: "not-executed",
          errors: Redacted.make(acknowledgments),
        });

      state.set("uncertain");
      execStarted = true;
      const reply = yield* mapBatchFailure(
        wire.execute(["EXEC"], undefined, (written) => {
          execMayHaveBeenWritten = written;
        }),
        (error) =>
          error instanceof AdmissionError ||
          (error instanceof ProtocolError && error.stage === "encode") ||
          (error instanceof ConnectionError && error.delivery === "unsent")
            ? notExecuted(error, "transaction-exec")
            : unknownBatch(prepared, error, "transaction-exec"),
      );
      execReplied = true;
      const checked = yield* Effect.result(checkServerReply(reply));
      if (checked._tag === "Failure") {
        const aborted =
          checked.failure instanceof ServerError && checked.failure.code === "EXECABORT";
        if (aborted) state.set("idle");
        return yield* new TransactionError({
          reason: "exec-rejected",
          execution: aborted ? "not-executed" : "unknown",
          errors: Redacted.make(checked.failure),
        });
      }

      const value = undecorate(reply);
      // Kvrocks RESP2 uses a null bulk for WATCH conflicts; every null here denotes aborted EXEC.
      if (value._tag === "Null") {
        state.set("idle");
        return { _tag: "Conflict" } as const;
      }
      if (value._tag !== "Array") return yield* mismatch("array", reply);

      state.set("idle");
      if (value.values.length !== prepared.length) return yield* mismatch("array-length", reply);
      const results = yield* decodeBatch(
        prepared,
        value.values.map((entry) => ({ _tag: "Replied", reply: entry })),
        "transaction-exec",
      );
      return { _tag: "Committed", results } as const satisfies TransactionOutcome<Cs>;
    }).pipe(
      Effect.onExit((exit) => {
        if (
          !Exit.isFailure(exit) ||
          (!Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause))
        )
          return Effect.void;
        if (execStarted)
          return execReplied
            ? Effect.void
            : Effect.fail(
                execMayHaveBeenWritten
                  ? unknownBatch(prepared, exit.cause, "transaction-exec")
                  : notExecuted(exit.cause, "transaction-exec"),
              );
        if (queueStarted && queueReplies === undefined) return Effect.void;

        return Effect.fail(notExecuted(exit.cause, "transaction-queue"));
      }),
      Effect.onExit(() => state.reset),
    );
  });
