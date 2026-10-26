import { Effect } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { simpleText, unsigned } from "#/command/reply/Data";
import { mismatch, undecorate } from "#/command/reply/Scalars";
import { ordinary } from "#/commands/internal/Command";
import { decimal, parse } from "#/commands/internal/Input";
import type { Decimal } from "#/commands/internal/Input";
import { numericLegacy, numericMatches } from "#/commands/json/NumericReply";
import { legacy, matching, LegacyPath, MatchPath } from "#/commands/json/Path";
import type { JsonPath } from "#/commands/json/Path";
import { moduleKeyed, moduleMetadata } from "#/commands/modules/Build";
import { moduleBoolean } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

const numeric = (name: string, key: RedisArgument, path: JsonPath, value: Decimal) =>
  moduleKeyed(
    "json",
    name,
    key,
    numericMatches,
    Effect.all([parse(MatchPath, path), decimal(value)]),
    "read-write",
  );
const legacyNumeric = (name: string, key: RedisArgument, path: string, value: Decimal) =>
  moduleKeyed(
    "json",
    name,
    key,
    numericLegacy,
    Effect.all([parse(LegacyPath, path), decimal(value)]),
    "read-write",
  );

export const jsonNumincrby = (key: RedisArgument, path: JsonPath, value: Decimal) =>
  numeric("JSON.NUMINCRBY", key, path, value);
export const jsonNummultby = (key: RedisArgument, path: JsonPath, value: Decimal) =>
  numeric("JSON.NUMMULTBY", key, path, value);
export const jsonNumpowby = (key: RedisArgument, path: JsonPath, value: Decimal) =>
  numeric("JSON.NUMPOWBY", key, path, value);
export const jsonNumincrbyLegacy = (key: RedisArgument, path: string, value: Decimal) =>
  legacyNumeric("JSON.NUMINCRBY", key, path, value);
export const jsonNummultbyLegacy = (key: RedisArgument, path: string, value: Decimal) =>
  legacyNumeric("JSON.NUMMULTBY", key, path, value);
export const jsonNumpowbyLegacy = (key: RedisArgument, path: string, value: Decimal) =>
  legacyNumeric("JSON.NUMPOWBY", key, path, value);

export const jsonToggle = (key: RedisArgument, path: JsonPath) =>
  matching("JSON.TOGGLE", key, path, moduleBoolean, Effect.succeed([]), "read-write");

const legacyBoolean: ReplyDecoder<boolean> = (reply) => {
  const value = undecorate(reply);
  if (value._tag !== "BlobString" && value._tag !== "SimpleString") return moduleBoolean(reply);
  return simpleText(reply).pipe(
    Effect.flatMap((token) =>
      token === "true" || token === "false"
        ? Effect.succeed(token === "true")
        : Effect.fail(mismatch("custom", reply)),
    ),
  );
};

export const jsonToggleLegacy = (key: RedisArgument, path: string) =>
  legacy("JSON.TOGGLE", key, path, legacyBoolean, Effect.succeed([]), "read-write");
export const jsonStrappend = (key: RedisArgument, path: JsonPath, encodedString: RedisArgument) =>
  matching("JSON.STRAPPEND", key, path, unsigned, Effect.succeed([encodedString]), "read-write");
export const jsonStrappendLegacy = (
  key: RedisArgument,
  path: string,
  encodedString: RedisArgument,
) => legacy("JSON.STRAPPEND", key, path, unsigned, Effect.succeed([encodedString]), "read-write");

export const jsonDebugMemory = (key: RedisArgument, path: JsonPath = "$") =>
  matching("JSON.DEBUG MEMORY", key, path, unsigned);
export const jsonDebugMemoryLegacy = (key: RedisArgument, path = ".") =>
  legacy("JSON.DEBUG MEMORY", key, path, unsigned);

export const jsonDebugHelp = () =>
  ordinary(
    moduleMetadata("json", "JSON.DEBUG HELP"),
    array(simpleText),
    Effect.succeed({ tokens: ["JSON.DEBUG", "HELP"], routing: { _tag: "Keyless" } }),
  );
