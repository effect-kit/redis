import type { Effect } from "effect";

import type { RedisExecutor } from "#/command/Executor";
import type {
  AnyCommand,
  BatchFailure,
  BatchValues,
  DecodeRequirements,
  PreparedBatch,
} from "#/sessions/batch/Types";

type ExecuteValues = <const Cs extends ReadonlyArray<AnyCommand>>(
  prepared: PreparedBatch<Cs>,
) => Effect.Effect<BatchValues<Cs>, BatchFailure<Cs>, DecodeRequirements<Cs[number]>>;

// Custom executors retain the public Results contract; owned executors may decode values directly.
const executors = new WeakMap<RedisExecutor, ExecuteValues>();

export const registerValuesExecutor = (executor: RedisExecutor, execute: ExecuteValues) => {
  executors.set(executor, execute);
  return executor;
};

export const valuesExecutor = (executor: RedisExecutor) => executors.get(executor);
