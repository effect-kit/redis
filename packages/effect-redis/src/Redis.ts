import { Context, Effect, Layer } from "effect";

import { CommandExecutor } from "./command/Executor.js";
import type { RedisExecutor } from "./command/Executor.js";
import { raw } from "./command/Raw.js";
import type { RawContract } from "./command/Raw.js";
import { connectionFamily } from "./commands/connection/Ping.js";
import { sortedSetFamily } from "./commands/sorted-sets/Zscore.js";
import { stringFamily } from "./commands/strings/Family.js";
import { keyFamily } from "./keys/Commands.js";
import type { RedisCommand } from "./protocol/encode.js";

export const makeRedis = (executor: RedisExecutor) => ({
  ...connectionFamily(executor),
  ...stringFamily(executor),
  ...sortedSetFamily(executor),
  ...keyFamily(executor),
  execute: executor.execute,
  executePrepared: executor.executePrepared,
  raw: (tokens: RedisCommand, contract: RawContract) => executor.execute(raw(tokens, contract)),
});
export type RedisClient = ReturnType<typeof makeRedis>;
export class Redis extends Context.Service<Redis, RedisClient>()("@envoy1084/effect-redis/Redis") {
  static readonly layer = Layer.effect(Redis, CommandExecutor.pipe(Effect.map(makeRedis)));
}
