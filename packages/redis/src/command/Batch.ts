import { Effect, Option } from "effect";

import { BatchExecutor } from "#/command/BatchExecutor";
import { batchValues, snapshotBatch } from "#/command/Compiled";
import type { CompiledBatch } from "#/command/Compiled";
import type { RedisExecutor } from "#/command/Executor";
import { ConnectionError } from "#/errors/ConnectionError";
import { UnsupportedCommandError } from "#/errors/UnsupportedCommandError";
import { prepareBatch } from "#/sessions/batch/Prepare";
import type {
  AnyCommand,
  BatchExecutorService,
  BatchFailure,
  BatchResults,
  DecodeRequirements,
  PreparedBatch,
} from "#/sessions/batch/Types";
import { observe } from "#/telemetry/Observe";

export const batchApi = (
  source: RedisExecutor,
  ownedBatches: BatchExecutorService | undefined,
  isClosed: () => boolean,
) => {
  const resolve = Effect.suspend(() => {
    if (source.executeBatchPrepared !== undefined)
      return Effect.succeed(source.executeBatchPrepared);
    return Effect.gen(function* () {
      const available = yield* Effect.serviceOption(BatchExecutor);
      const batches = ownedBatches ?? Option.getOrUndefined(available);
      if (batches === undefined)
        return yield* new UnsupportedCommandError({ delivery: "unsent", reason: "execution-mode" });
      return <const Cs extends ReadonlyArray<AnyCommand>>(prepared: PreparedBatch<Cs>) => {
        const bound = prepared.map((command) => ({ prepare: Effect.succeed(command) }));
        // Preparation changes no slot's value/error/decoder type or position.
        return batches.pipeline(bound) as Effect.Effect<
          BatchResults<Cs>,
          BatchFailure<Cs>,
          DecodeRequirements<Cs[number]>
        >;
      };
    });
  });

  const guard = () =>
    isClosed()
      ? new ConnectionError({ reason: "closed", delivery: "unsent", generation: 0 })
      : undefined;

  return {
    compile: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      Effect.gen(function* () {
        const closed = guard();
        if (closed !== undefined) return yield* closed;
        const prepared = yield* snapshotBatch(commands);
        const run = yield* resolve;
        const plan: CompiledBatch<Cs> = Object.freeze({
          execute: () =>
            observe(
              "batch",
              Effect.suspend(() => {
                const ownerClosed = guard();
                return ownerClosed === undefined
                  ? run<Cs>(prepared).pipe(Effect.flatMap(batchValues<Cs>))
                  : Effect.fail(ownerClosed);
              }),
            ),
        });
        return plan;
      }),
    batch: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      observe(
        "batch",
        Effect.gen(function* () {
          const closed = guard();
          if (closed !== undefined) return yield* closed;
          const prepared = yield* prepareBatch(commands, 256);
          const run = yield* resolve;
          return yield* run<Cs>(prepared).pipe(Effect.flatMap(batchValues<Cs>));
        }),
      ),
  };
};
