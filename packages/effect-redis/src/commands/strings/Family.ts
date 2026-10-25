import type { RedisExecutor } from "../../command/Executor.js";
import type { RedisArgument } from "../../RedisArgument.js";
import { get, getBytes } from "./Get.js";
import { incr } from "./Incr.js";
import { set } from "./Set.js";
import type { SetOptions } from "./SetOptions.js";

export const stringFamily = (executor: RedisExecutor) => ({
  get: (key: RedisArgument) => executor.execute(get(key)),
  getBytes: (key: RedisArgument) => executor.execute(getBytes(key)),
  set: <O extends SetOptions = {}>(key: RedisArgument, value: RedisArgument, options?: O) =>
    executor.execute(set(key, value, options)),
  incr: (key: RedisArgument) => executor.execute(incr(key)),
});
