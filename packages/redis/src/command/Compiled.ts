import { Effect, Redacted, Result } from "effect";

import { defineCommand } from "#/command/Command";
import { BatchError } from "#/errors/BatchError";
import { registerCompiledFrames } from "#/protocol/CompiledFrames";
import { measureCommand } from "#/protocol/encode";
import type { RedisCommand } from "#/protocol/encode";
import { encodeLimits } from "#/protocol/limits";
import { prepareBatch } from "#/sessions/batch/Prepare";
import type {
  AnyCommand,
  BatchFailure,
  BatchResults,
  BatchValues,
  DecodeRequirements,
  PartialBatchError,
  PreparedBatch,
} from "#/sessions/batch/Types";

export interface CompiledBatch<Cs extends ReadonlyArray<AnyCommand>> {
  readonly execute: () => Effect.Effect<
    BatchValues<Cs>,
    BatchFailure<Cs>,
    DecodeRequirements<Cs[number]>
  >;
}

const compiledTokens = new WeakMap<
  object,
  {
    readonly prepared: PreparedBatch<ReadonlyArray<AnyCommand>>;
    readonly tokens: ReadonlyArray<RedisCommand>;
  }
>();

/** Provider preparation may rebuild the tuple, but must keep each private descriptor's identity. */
export const batchTokens = (prepared: PreparedBatch<ReadonlyArray<AnyCommand>>) => {
  const first = prepared[0];
  const cached = first === undefined ? undefined : compiledTokens.get(first);
  return cached !== undefined &&
    cached.prepared.length === prepared.length &&
    prepared.every((command, index) => command === cached.prepared[index])
    ? cached.tokens
    : prepared.map((command) => command.tokens);
};

export const snapshotBatch = <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
  Effect.gen(function* () {
    const prepared = yield* prepareBatch(commands, 256);
    const limits = yield* Effect.fromResult(encodeLimits());
    let remaining = limits.maxQueuedBytes;
    for (const command of prepared) {
      const measured = yield* Effect.fromResult(measureCommand(command.tokens, limits, remaining));
      remaining -= measured.total;
    }

    const snapshots = yield* Effect.forEach(
      prepared,
      (command) =>
        defineCommand({
          ...command,
          tokens: command.tokens.map((token) =>
            typeof token === "string" ? token : new Uint8Array(token),
          ) as unknown as RedisCommand,
          routing: structuredClone(command.routing),
        }).prepare,
    );
    const tokens = snapshots.map((command) => {
      Object.freeze(command.tokens);
      Object.freeze(command.routing);
      Object.freeze(command);
      return command.tokens;
    });
    Object.freeze(snapshots);
    Object.freeze(tokens);
    const first = snapshots[0];
    if (first !== undefined) compiledTokens.set(first, { prepared: snapshots, tokens });
    registerCompiledFrames(tokens);
    return snapshots as PreparedBatch<Cs>;
  });

/** Every reply has been drained and decoded before a values-only batch reports a slot failure. */
export const batchValues = <Cs extends ReadonlyArray<AnyCommand>>(results: BatchResults<Cs>) => {
  if (results.some(Result.isFailure)) {
    return Effect.fail(
      new BatchError({
        phase: "pipeline",
        execution: "replied",
        outcomes: Redacted.make(
          results.map((result, index) => ({ _tag: "Completed", index, result })),
        ),
      }) as PartialBatchError<Cs>,
    );
  }
  return Effect.succeed(
    results.map((result) => {
      if (Result.isFailure(result)) throw new Error("Failed batch value after validation");
      return result.success;
    }) as BatchValues<Cs>,
  );
};
