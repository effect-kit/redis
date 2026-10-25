import { defineCommand } from "../../command/Command.js";
import { blob, optional, text } from "../../command/reply/Scalars.js";
import type { RedisArgument } from "../../RedisArgument.js";
import { metadata } from "../Metadata.js";

export const getMetadata = metadata("GET", "strings", ["COMMAND-02", "COMMAND-03"]);
export const getBytes = (key: RedisArgument) =>
  defineCommand({
    metadata: getMetadata,
    tokens: ["GET", key],
    routing: { _tag: "Keys", keys: [{ index: 1, access: "read" }] },
    decode: optional(blob),
  });
export const get = (key: RedisArgument) =>
  defineCommand({
    metadata: getMetadata,
    tokens: ["GET", key],
    routing: { _tag: "Keys", keys: [{ index: 1, access: "read" }] },
    decode: optional(text),
  });
