import { Effect, Schema } from "effect";

import { boolean } from "#/command/reply/Data";
import { parse } from "#/commands/internal/Input";
import { Name, command } from "#/commands/upstash/Build";
import type { RedisArgument } from "#/RedisArgument";

const Field = Schema.Union([
  Schema.Struct({
    name: Schema.NonEmptyString,
    type: Schema.Literal("TEXT"),
    noStem: Schema.optionalKey(Schema.Boolean),
    noTokenize: Schema.optionalKey(Schema.Boolean),
    from: Schema.optionalKey(Schema.NonEmptyString),
  }),
  Schema.Struct({
    name: Schema.NonEmptyString,
    type: Schema.Literals(["U64", "I64", "F64", "BOOL", "DATE"]),
    fast: Schema.optionalKey(Schema.Boolean),
    from: Schema.optionalKey(Schema.NonEmptyString),
  }),
  Schema.Struct({
    name: Schema.NonEmptyString,
    type: Schema.Literals(["KEYWORD", "FACET"]),
    from: Schema.optionalKey(Schema.NonEmptyString),
  }),
]);

const Create = Schema.Struct({
  on: Schema.Union([
    Schema.Struct({
      type: Schema.Literals(["JSON", "HASH", "STRING"]),
      prefixes: Schema.NonEmptyArray(Schema.String),
    }),
    Schema.Struct({ type: Schema.Literal("STREAM"), key: Name }),
  ]),
  fields: Schema.NonEmptyArray(Field),
  language: Schema.optionalKey(
    Schema.Literals([
      "arabic",
      "danish",
      "dutch",
      "english",
      "finnish",
      "french",
      "german",
      "greek",
      "hungarian",
      "italian",
      "norwegian",
      "portuguese",
      "romanian",
      "russian",
      "spanish",
      "swedish",
      "tamil",
      "turkish",
    ]),
  ),
  skipInitialScan: Schema.optionalKey(Schema.Boolean),
  existsOk: Schema.optionalKey(Schema.Boolean),
}).check(
  Schema.makeFilter((options) => {
    if (new Set(options.fields.map((field) => field.name)).size !== options.fields.length)
      return false;
    if (options.on.type === "STREAM") return true;
    const prefixes = options.on.prefixes;
    return prefixes.every((prefix, index) =>
      prefixes.every((other, otherIndex) => index === otherIndex || !other.startsWith(prefix)),
    );
  }),
);

export type SearchCreateOptions = typeof Create.Type;
export type SearchField = typeof Field.Type;

/** All fields are validated and snapshotted before SCHEMA, which must be the final clause. */
export const searchCreate = (name: RedisArgument, options: SearchCreateOptions) =>
  command(
    "SEARCH.CREATE",
    boolean,
    Effect.gen(function* () {
      const key = yield* parse(Name, name);
      const selected = yield* parse(Create, options);
      const on = selected.on;
      return [
        key,
        "ON",
        on.type,
        ...(on.type === "STREAM"
          ? [on.key]
          : ["PREFIX", String(on.prefixes.length), ...on.prefixes]),
        ...(selected.language === undefined ? [] : ["LANGUAGE", selected.language]),
        ...(selected.skipInitialScan ? ["SKIPINITIALSCAN"] : []),
        ...(selected.existsOk ? ["EXISTSOK"] : []),
        "SCHEMA",
        ...selected.fields.flatMap((field) => {
          const tokens: Array<string> = [field.name, field.type];
          if ("noStem" in field && field.noStem) tokens.push("NOSTEM");
          if ("noTokenize" in field && field.noTokenize) tokens.push("NOTOKENIZE");
          if ("fast" in field && field.fast) tokens.push("FAST");
          if (field.from !== undefined) tokens.push("FROM", field.from);
          return tokens;
        }),
      ];
    }),
  );
