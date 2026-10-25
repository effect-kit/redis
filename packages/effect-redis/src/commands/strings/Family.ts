import type { RedisExecutor } from "#/command/Executor";
import { get, getBytes } from "#/commands/strings/Get";
import { incr } from "#/commands/strings/Incr";
import { set } from "#/commands/strings/Set";
import type { SetOptions } from "#/commands/strings/SetOptions";
import type { RedisArgument } from "#/RedisArgument";

export const stringFamily = (executor: RedisExecutor) => ({
  get: (key: RedisArgument) => executor.execute(get(key)),
  getBytes: (key: RedisArgument) => executor.execute(getBytes(key)),
  set: <O extends SetOptions = {}>(key: RedisArgument, value: RedisArgument, options?: O) =>
    executor.execute(set(key, value, options)),
  incr: (key: RedisArgument) => executor.execute(incr(key)),
});
