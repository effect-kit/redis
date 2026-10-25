import { defineCommand } from "#/command/Command";
import type { RedisExecutor } from "#/command/Executor";
import { optional } from "#/command/reply/Scalars";
import { score, scoreToken } from "#/command/reply/Score";
import { metadata } from "#/commands/Metadata";
import type { RedisArgument } from "#/RedisArgument";

export const zscoreMetadata = metadata("ZSCORE", "sorted-sets", ["COMMAND-05"]);
export const zscore = (key: RedisArgument, member: RedisArgument) =>
  defineCommand({
    metadata: zscoreMetadata,
    tokens: ["ZSCORE", key, member],
    routing: { _tag: "Keys", keys: [{ index: 1, access: "read" }] },
    decode: optional(score),
  });
export const zscoreToken = (key: RedisArgument, member: RedisArgument) =>
  defineCommand({
    metadata: zscoreMetadata,
    tokens: ["ZSCORE", key, member],
    routing: { _tag: "Keys", keys: [{ index: 1, access: "read" }] },
    decode: optional(scoreToken),
  });
export const sortedSetFamily = (executor: RedisExecutor) => ({
  zscore: (key: RedisArgument, member: RedisArgument) => executor.execute(zscore(key, member)),
  zscoreToken: (key: RedisArgument, member: RedisArgument) =>
    executor.execute(zscoreToken(key, member)),
});
