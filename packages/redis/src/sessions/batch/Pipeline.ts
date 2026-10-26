import { Effect, Redacted } from "effect";

import { BatchError } from "#/errors/BatchError";
import { decodeBatch } from "#/sessions/batch/Decode";
import { mapBatchFailure } from "#/sessions/batch/Failure";
import type {
  AnyCommand,
  BatchOutcomes,
  PartialBatchError,
  PreparedBatch,
} from "#/sessions/batch/Types";
import type { SessionWire } from "#/sessions/pool/Wire";

export const runPipeline = <const Cs extends ReadonlyArray<AnyCommand>>(
  wire: SessionWire,
  prepared: PreparedBatch<Cs>,
) =>
  Effect.gen(function* () {
    const replies = yield* mapBatchFailure(
      wire.batch(prepared.map((command) => command.tokens)),
      (error) =>
        (error instanceof BatchError
          ? error
          : new BatchError({
              phase: "pipeline",
              execution: "not-executed",
              outcomes: Redacted.make(
                prepared.map((_, index) => ({
                  _tag: "Unsent",
                  index,
                  error: Redacted.make(error),
                })),
              ),
            })) as PartialBatchError<Cs>,
    );

    return yield* decodeBatch(prepared, replies, "pipeline");
  });

export const unknownBatch = <Cs extends ReadonlyArray<AnyCommand>>(
  prepared: PreparedBatch<Cs>,
  error: unknown,
  phase: BatchError["phase"],
) =>
  new BatchError({
    phase,
    execution: phase === "transaction-queue" ? "not-executed" : "unknown",
    outcomes: Redacted.make(
      prepared.map((_, index) => ({ _tag: "Unknown", index, error: Redacted.make(error) })),
    ) as Redacted.Redacted<BatchOutcomes<Cs>>,
  }) as PartialBatchError<Cs>;
