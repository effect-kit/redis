import { Effect, Option, Schema } from "effect";

import type { PayloadCodec } from "#/codecs/PayloadCodec";
import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { nullable, simpleText, unsigned, withLength } from "#/command/reply/Data";
import { blob, undecorate } from "#/command/reply/Scalars";
import { keyIndexes, ordinary } from "#/commands/internal/Command";
import { Arguments, parse } from "#/commands/internal/Input";
import { legacy, matching, LegacyPath, MatchPath } from "#/commands/json/Path";
import type { JsonPath, JsonMatches } from "#/commands/json/Path";
import { moduleKeyed, moduleMetadata } from "#/commands/modules/Build";
import { losslessValue } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

export interface JsonGetOptions {
  readonly paths?: readonly [string, ...string[]];
  readonly indent?: string;
  readonly newline?: string;
  readonly space?: string;
}
const GetOptions = Schema.Struct({
  paths: Schema.optionalKey(Schema.NonEmptyArray(Schema.NonEmptyString)),
  indent: Schema.optionalKey(Schema.String),
  newline: Schema.optionalKey(Schema.String),
  space: Schema.optionalKey(Schema.String),
});
const getArguments = (options: JsonGetOptions) =>
  parse(GetOptions, options).pipe(
    Effect.map((selected) => [
      ...(selected.indent === undefined ? [] : ["INDENT", selected.indent]),
      ...(selected.newline === undefined ? [] : ["NEWLINE", selected.newline]),
      ...(selected.space === undefined ? [] : ["SPACE", selected.space]),
      // Use an explicit legacy root rather than depending on a server/protocol default.
      ...(selected.paths ?? ["."]),
    ]),
  );

/** Returns serialized JSON bytes, including JSONPath's matching-value envelopes. */
export const jsonGet = (key: RedisArgument, options: JsonGetOptions = {}) =>
  moduleKeyed("json", "JSON.GET", key, nullable(blob), getArguments(options));

export const jsonGetWith = <A, RD, RE>(
  key: RedisArgument,
  codec: PayloadCodec<A, RD, RE>,
  options: JsonGetOptions = {},
) => ({
  prepare: jsonGet(key, options).prepare.pipe(
    Effect.map((prepared) => ({
      ...prepared,
      decode: (reply: Parameters<typeof prepared.decode>[0]) =>
        prepared
          .decode(reply)
          .pipe(
            Effect.flatMap((value) =>
              Option.isNone(value)
                ? Effect.succeed(Option.none<A>())
                : codec.decode(value.value).pipe(Effect.map(Option.some)),
            ),
          ),
    })),
  ),
});

/** Redis RESP3-only expansion. An incompatible blob reply is rejected, never reinterpreted as matches. */
export const jsonGetExpanded = (
  key: RedisArgument,
  paths: readonly [string, ...string[]] = ["$"],
) =>
  moduleKeyed(
    "json",
    "JSON.GET",
    key,
    nullable(array(array(losslessValue))),
    parse(Schema.NonEmptyArray(Schema.NonEmptyString), paths).pipe(
      Effect.map((selected) => ["FORMAT", "EXPAND", ...selected]),
    ),
  );

export const jsonGetExpandedOneLevel = (
  key: RedisArgument,
  paths: readonly [string, ...string[]] = ["$"],
) =>
  moduleKeyed(
    "json",
    "JSON.GET",
    key,
    nullable(array(losslessValue)),
    parse(Schema.NonEmptyArray(Schema.NonEmptyString), paths).pipe(
      Effect.map((selected) => ["FORMAT", "EXPAND1", ...selected]),
    ),
  );

export const jsonMget = (keys: readonly [RedisArgument, ...RedisArgument[]], path: string) => ({
  prepare: Effect.gen(function* () {
    const selected = yield* parse(Arguments, keys);
    const selectedPath = yield* parse(Schema.NonEmptyString, path);

    return yield* ordinary(
      moduleMetadata("json", "JSON.MGET"),
      withLength(selected.length, array(nullable(blob))),
      Effect.succeed({
        tokens: ["JSON.MGET", ...selected, selectedPath],
        routing: keyIndexes(
          selected.map((_, index) => index + 1),
          "read",
        ),
      }),
    ).prepare;
  }),
});

const typeMatches: ReplyDecoder<JsonMatches<string>> = (reply) => {
  const value = undecorate(reply);
  const first = value._tag === "Array" && value.values.length === 1 ? value.values[0] : undefined;
  // Redis RESP3 wraps TYPE once more, including its missing-key null; Valkey keeps the RESP2 shape.
  return nullable(array(nullable(simpleText)))(
    first?._tag === "Array" || first?._tag === "Null" ? first : reply,
  );
};

const typeLegacy: ReplyDecoder<Option.Option<string>> = (reply) => {
  const value = undecorate(reply);
  const first = value._tag === "Array" && value.values.length === 1 ? value.values[0] : undefined;
  return nullable(simpleText)(first ?? reply);
};

export const jsonType = (key: RedisArgument, path: JsonPath = "$") =>
  moduleKeyed(
    "json",
    "JSON.TYPE",
    key,
    typeMatches,
    parse(MatchPath, path).pipe(Effect.map((selected) => [selected])),
  );

export const jsonTypeLegacy = (key: RedisArgument, path = ".") =>
  moduleKeyed(
    "json",
    "JSON.TYPE",
    key,
    typeLegacy,
    parse(LegacyPath, path).pipe(Effect.map((selected) => [selected])),
  );

export const jsonObjkeys = (key: RedisArgument, path: JsonPath = "$") =>
  matching("JSON.OBJKEYS", key, path, array(blob));

export const jsonObjkeysLegacy = (key: RedisArgument, path = ".") =>
  legacy("JSON.OBJKEYS", key, path, array(blob));

export const jsonObjlen = (key: RedisArgument, path: JsonPath = "$") =>
  matching("JSON.OBJLEN", key, path, unsigned);

export const jsonObjlenLegacy = (key: RedisArgument, path = ".") =>
  legacy("JSON.OBJLEN", key, path, unsigned);

export const jsonStrlen = (key: RedisArgument, path: JsonPath = "$") =>
  matching("JSON.STRLEN", key, path, unsigned);

export const jsonStrlenLegacy = (key: RedisArgument, path = ".") =>
  legacy("JSON.STRLEN", key, path, unsigned);

export const jsonResp = (key: RedisArgument, path: string = "$") =>
  moduleKeyed(
    "json",
    "JSON.RESP",
    key,
    losslessValue,
    parse(Schema.NonEmptyString, path).pipe(Effect.map((selected) => [selected])),
  );
