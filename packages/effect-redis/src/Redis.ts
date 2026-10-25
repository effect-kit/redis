import { Context, Effect, Layer } from "effect";

import { CommandExecutor } from "#/command/Executor";
import type { RedisExecutor } from "#/command/Executor";
import { raw } from "#/command/Raw";
import type { RawContract } from "#/command/Raw";
import { connectionFamily } from "#/commands/connection/Ping";
import { sortedSetFamily } from "#/commands/sorted-sets/Zscore";
import { stringFamily } from "#/commands/strings/Family";
import { keyFamily } from "#/keys/Commands";
import type { RedisCommand } from "#/protocol/encode";

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
