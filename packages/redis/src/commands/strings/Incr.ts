import { integer } from "#/command/reply/Scalars";
import { singleKeyCommand } from "#/command/SingleKey";
import { metadata } from "#/commands/Metadata";
import type { RedisArgument } from "#/RedisArgument";

export const incrMetadata = metadata("INCR", "strings", ["COMMAND-04"]);

export const incr = (key: RedisArgument) =>
  singleKeyCommand(incrMetadata, key, [], "read-write", integer);
