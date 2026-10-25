import { defineCommand } from "../../command/Command.js";
import { integer } from "../../command/reply/Scalars.js";
import type { RedisArgument } from "../../RedisArgument.js";
import { metadata } from "../Metadata.js";

export const incrMetadata = metadata("INCR", "strings", ["COMMAND-04"]);
export const incr = (key: RedisArgument) =>
  defineCommand({
    metadata: incrMetadata,
    tokens: ["INCR", key],
    routing: { _tag: "Keys", keys: [{ index: 1, access: "read-write" }] },
    decode: integer,
  });
