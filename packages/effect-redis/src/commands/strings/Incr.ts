import { defineCommand } from "#/command/Command";
import { integer } from "#/command/reply/Scalars";
import { metadata } from "#/commands/Metadata";
import type { RedisArgument } from "#/RedisArgument";

export const incrMetadata = metadata("INCR", "strings", ["COMMAND-04"]);
export const incr = (key: RedisArgument) =>
  defineCommand({
    metadata: incrMetadata,
    tokens: ["INCR", key],
    routing: { _tag: "Keys", keys: [{ index: 1, access: "read-write" }] },
    decode: integer,
  });
