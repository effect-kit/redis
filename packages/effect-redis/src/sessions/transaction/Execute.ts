import { Effect, Redacted } from "effect";

import { checkServerReply } from "#/command/Decode";
import { status, undecorate, mismatch } from "#/command/reply/Scalars";
import { ServerError } from "#/errors/ServerError";
import { TransactionError } from "#/errors/TransactionError";
import { decodeBatch } from "#/sessions/batch/Decode";
import { mapBatchFailure } from "#/sessions/batch/Failure";
import { unknownBatch } from "#/sessions/batch/Pipeline";
import type { AnyCommand, PreparedBatch, TransactionOutcome } from "#/sessions/batch/Types";
import { exchange } from "#/sessions/controls/Exchange";
import type { SessionWire } from "#/sessions/pool/Wire";
import type { SessionState } from "#/sessions/transaction/State";

export const runTransaction = <Cs extends ReadonlyArray<AnyCommand>>(
  wire: SessionWire,
  state: SessionState,
  prepared: PreparedBatch<Cs>,
) =>
  Effect.gen(function* () {
    state.set("uncertain");
    yield* exchange(wire, ["MULTI"], status("OK"));
    state.set("multi");

    const queued = yield* mapBatchFailure(
      wire.batch(
        prepared.map((command) => command.tokens),
        undefined,
        "transaction-queue",
      ),
      (error) => unknownBatch(prepared, error, "transaction-queue"),
    );
    if (queued.some((reply) => reply._tag !== "Replied"))
      return yield* Effect.fail(unknownBatch(prepared, queued, "transaction-queue"));

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
    const reply = yield* mapBatchFailure(wire.execute(["EXEC"]), (error) =>
      unknownBatch(prepared, error, "transaction-exec"),
    );
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
  }).pipe(Effect.onExit(() => state.reset));
