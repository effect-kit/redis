import { Effect, Redacted } from "effect";

import { checkServerReply } from "#/command/Decode";
import { mismatch, undecorate } from "#/command/reply/Scalars";
import { ServerError } from "#/errors/ServerError";
import { TransactionError } from "#/errors/TransactionError";
import type { RespValue } from "#/protocol/RespValue";
import { decodeBatch } from "#/sessions/batch/Decode";
import type { AnyCommand, PreparedBatch, TransactionOutcome } from "#/sessions/batch/Types";
import type { SessionState } from "#/sessions/transaction/State";

export const decodeTransaction = <Cs extends ReadonlyArray<AnyCommand>>(
  state: SessionState,
  prepared: PreparedBatch<Cs>,
  reply: RespValue,
) =>
  Effect.gen(function* () {
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
  });
