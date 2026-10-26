import { Effect, Schema } from "effect";

import { members, simpleText } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { Argument, Finite, Positive, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyless } from "#/commands/modules/Build";
import { fieldTokens } from "#/commands/search/index/Fields";
import type { SearchField } from "#/commands/search/index/Fields";
import type { RedisArgument } from "#/RedisArgument";

export interface SearchCreateOptions {
  readonly on?: "HASH" | "JSON";
  readonly indexAll?: "ENABLE" | "DISABLE";
  readonly prefixes?: ReadonlyArray<RedisArgument>;
  readonly filter?: RedisArgument;
  readonly language?: string;
  readonly languageField?: RedisArgument;
  readonly score?: number;
  readonly scoreField?: RedisArgument;
  readonly payloadField?: RedisArgument;
  readonly maxTextFields?: boolean;
  readonly temporarySeconds?: Integer;
  readonly noOffsets?: boolean;
  readonly noHighlight?: boolean;
  readonly noFields?: boolean;
  readonly noFrequencies?: boolean;
  readonly stopWords?: ReadonlyArray<RedisArgument>;
  readonly skipInitialScan?: boolean;
}
const Options = Schema.Struct({
  on: Schema.optionalKey(Schema.Literals(["HASH", "JSON"])),
  indexAll: Schema.optionalKey(Schema.Literals(["ENABLE", "DISABLE"])),
  prefixes: Schema.optionalKey(Schema.Array(Argument)),
  filter: Schema.optionalKey(Argument),
  language: Schema.optionalKey(Schema.NonEmptyString),
  languageField: Schema.optionalKey(Argument),
  score: Schema.optionalKey(Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  scoreField: Schema.optionalKey(Argument),
  payloadField: Schema.optionalKey(Argument),
  maxTextFields: Schema.optionalKey(Schema.Boolean),
  temporarySeconds: Schema.optionalKey(Positive),
  noOffsets: Schema.optionalKey(Schema.Boolean),
  noHighlight: Schema.optionalKey(Schema.Boolean),
  noFields: Schema.optionalKey(Schema.Boolean),
  noFrequencies: Schema.optionalKey(Schema.Boolean),
  stopWords: Schema.optionalKey(Schema.Array(Argument)),
  skipInitialScan: Schema.optionalKey(Schema.Boolean),
});

export const ftCreate = (
  index: RedisArgument,
  schema: readonly [SearchField, ...SearchField[]],
  options: SearchCreateOptions = {},
) =>
  moduleKeyless(
    "search",
    "FT.CREATE",
    status("OK"),
    Effect.gen(function* () {
      const selected = yield* parse(Options, options);
      const definition = yield* fieldTokens(schema);

      return [
        index,
        ...(selected.on === undefined ? [] : ["ON", selected.on]),
        ...(selected.indexAll === undefined ? [] : ["INDEXALL", selected.indexAll]),
        ...(selected.prefixes === undefined
          ? []
          : ["PREFIX", String(selected.prefixes.length), ...selected.prefixes]),
        ...(selected.filter === undefined ? [] : ["FILTER", selected.filter]),
        ...(selected.language === undefined ? [] : ["LANGUAGE", selected.language]),
        ...(selected.languageField === undefined ? [] : ["LANGUAGE_FIELD", selected.languageField]),
        ...(selected.score === undefined ? [] : ["SCORE", String(selected.score)]),
        ...(selected.scoreField === undefined ? [] : ["SCORE_FIELD", selected.scoreField]),
        ...(selected.payloadField === undefined ? [] : ["PAYLOAD_FIELD", selected.payloadField]),
        ...(selected.maxTextFields ? ["MAXTEXTFIELDS"] : []),
        ...(selected.temporarySeconds === undefined
          ? []
          : ["TEMPORARY", String(selected.temporarySeconds)]),
        ...(selected.noOffsets ? ["NOOFFSETS"] : []),
        ...(selected.noHighlight ? ["NOHL"] : []),
        ...(selected.noFields ? ["NOFIELDS"] : []),
        ...(selected.noFrequencies ? ["NOFREQS"] : []),
        ...(selected.stopWords === undefined
          ? []
          : ["STOPWORDS", String(selected.stopWords.length), ...selected.stopWords]),
        ...(selected.skipInitialScan ? ["SKIPINITIALSCAN"] : []),
        "SCHEMA",
        ...definition,
      ];
    }),
  );
export const ftAlter = (
  index: RedisArgument,
  schema: readonly [SearchField, ...SearchField[]],
  options: { readonly skipInitialScan?: boolean } = {},
) =>
  moduleKeyless(
    "search",
    "FT.ALTER",
    status("OK"),
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({ skipInitialScan: Schema.optionalKey(Schema.Boolean) }),
        options,
      );
      return [
        index,
        ...(selected.skipInitialScan ? ["SKIPINITIALSCAN"] : []),
        "SCHEMA",
        "ADD",
        ...(yield* fieldTokens(schema)),
      ];
    }),
  );
export const ftDropindex = (
  index: RedisArgument,
  options: { readonly deleteDocuments?: boolean } = {},
) =>
  moduleKeyless(
    "search",
    "FT.DROPINDEX",
    status("OK"),
    parse(Schema.Struct({ deleteDocuments: Schema.optionalKey(Schema.Boolean) }), options).pipe(
      Effect.map((selected) => [index, ...(selected.deleteDocuments ? ["DD"] : [])]),
    ),
  );
export const ftInfo = (index: RedisArgument) =>
  moduleKeyless("search", "FT.INFO", fields, Effect.succeed([index]));
export const ftList = () => moduleKeyless("search", "FT._LIST", members(simpleText));
