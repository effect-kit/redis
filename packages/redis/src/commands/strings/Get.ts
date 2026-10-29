import { blob, optional, text } from "#/command/reply/Scalars";
import { singleKeyCommand } from "#/command/SingleKey";
import { metadata } from "#/commands/Metadata";
import type { RedisArgument } from "#/RedisArgument";

export const getMetadata = metadata("GET", "strings", ["COMMAND-02", "COMMAND-03"]);

const decodeBytes = optional(blob);
const decodeText = optional(text);

export const getBytes = (key: RedisArgument) =>
  singleKeyCommand(getMetadata, key, [], "read", decodeBytes);

export const get = (key: RedisArgument) =>
  singleKeyCommand(getMetadata, key, [], "read", decodeText);
