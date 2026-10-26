import { Effect, Option, Schema } from "effect";

import type { PayloadCodec } from "#/codecs/PayloadCodec";
import { fromPreparation } from "#/command/Command";
import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { nullable, pairs, tuple } from "#/command/reply/Data";
import { blob, mismatch, undecorate } from "#/command/reply/Scalars";
import { parse, Finite } from "#/commands/internal/Input";
import { command, Name } from "#/commands/upstash/Build";
import { jsonArgument } from "#/commands/upstash/JsonArgument";
import type { JsonObjectArgument } from "#/commands/upstash/JsonArgument";
import { finiteScore } from "#/commands/upstash/Reply";
import type { PayloadError } from "#/errors/PayloadError";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisArgument } from "#/RedisArgument";

const Names = Schema.NonEmptyArray(Schema.NonEmptyString);
const ScoreFunctions = Schema.Struct({
  fields: Schema.NonEmptyArray(
    Schema.Struct({
      field: Schema.NonEmptyString,
      modifier: Schema.optionalKey(
        Schema.Literals([
          "NONE",
          "LOG",
          "LOG1P",
          "LOG2P",
          "LN",
          "LN1P",
          "LN2P",
          "SQUARE",
          "SQRT",
          "RECIPROCAL",
        ]),
      ),
      factor: Schema.optionalKey(Finite),
      missing: Schema.optionalKey(Finite),
    }),
  ),
  scoreMode: Schema.optionalKey(Schema.Literals(["SUM", "MULTIPLY", "REPLACE"])),
  combineMode: Schema.optionalKey(Schema.Literals(["SUM", "MULTIPLY"])),
});

const Common = {
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10000 }))),
  orderBy: Schema.optionalKey(
    Schema.Struct({
      field: Schema.NonEmptyString,
      direction: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])),
    }),
  ),
  scoreFunctions: Schema.optionalKey(ScoreFunctions),
};
const QueryOptions = Schema.Struct({
  ...Common,
  select: Schema.optionalKey(Names),
  highlight: Schema.optionalKey(
    Schema.Struct({
      fields: Names,
      tags: Schema.optionalKey(Schema.Tuple([Schema.String, Schema.String])),
    }),
  ),
}).check(
  Schema.makeFilter(
    (selected) => selected.orderBy === undefined || selected.scoreFunctions === undefined,
  ),
);
const KeysOptions = Schema.Struct(Common).check(
  Schema.makeFilter(
    (selected) => selected.orderBy === undefined || selected.scoreFunctions === undefined,
  ),
);

export type SearchQueryOptions = typeof QueryOptions.Type;
export type SearchKeysOptions = typeof KeysOptions.Type;
export interface SearchHit {
  readonly key: Uint8Array;
  readonly score: number;
  readonly content: ReadonlyArray<readonly [Uint8Array, RespValue]>;
}
export type SearchKeyHit = Omit<SearchHit, "content">;

const queryArguments = Effect.fnUntraced(function* (
  name: RedisArgument,
  filter: JsonObjectArgument,
  options: SearchQueryOptions,
  keys: boolean,
) {
  const selected = keys ? yield* parse(KeysOptions, options) : yield* parse(QueryOptions, options);
  const content: SearchQueryOptions = selected;
  const functions = selected.scoreFunctions;
  return {
    maximum: selected.limit ?? 10,
    tokens: [
      yield* parse(Name, name),
      yield* jsonArgument(filter),
      ...(selected.limit === undefined ? [] : ["LIMIT", String(selected.limit)]),
      ...(selected.offset === undefined ? [] : ["OFFSET", String(selected.offset)]),
      ...(selected.orderBy === undefined
        ? []
        : [
            "ORDERBY",
            selected.orderBy.field,
            ...(selected.orderBy.direction === undefined ? [] : [selected.orderBy.direction]),
          ]),
      ...(keys ? ["NOCONTENT"] : []),
      ...(content.select === undefined
        ? []
        : ["SELECT", String(content.select.length), ...content.select]),
      ...(content.highlight === undefined
        ? []
        : [
            "HIGHLIGHT",
            "FIELDS",
            String(content.highlight.fields.length),
            ...content.highlight.fields,
            ...(content.highlight.tags === undefined ? [] : ["TAGS", ...content.highlight.tags]),
          ]),
      ...(functions === undefined
        ? []
        : [
            "SCOREFUNC",
            ...functions.fields.flatMap((field) => [
              "FIELDVALUE",
              field.field,
              ...(field.modifier === undefined ? [] : ["MODIFIER", field.modifier]),
              ...(field.factor === undefined ? [] : ["FACTOR", String(field.factor)]),
              ...(field.missing === undefined ? [] : ["MISSING", String(field.missing)]),
            ]),
            ...(functions.scoreMode === undefined ? [] : ["SCOREMODE", functions.scoreMode]),
            ...(functions.combineMode === undefined ? [] : ["COMBINEMODE", functions.combineMode]),
          ]),
    ],
  };
});

const contentHit: ReplyDecoder<SearchHit> = (reply: RespValue) =>
  Effect.gen(function* () {
    const value = undecorate(reply);
    if (value._tag !== "Array" || value.values.length !== 3) return yield* mismatch("array", reply);
    const [key, relevance, content] = value.values;
    if (key === undefined || relevance === undefined) return yield* mismatch("array", reply);

    const identity = { key: yield* blob(key), score: yield* finiteScore(relevance) };
    if (content === undefined) return yield* mismatch("array", reply);
    return { ...identity, content: yield* pairs(blob, Effect.succeed)(content) };
  });

const keyHit: ReplyDecoder<SearchKeyHit> = (reply) =>
  tuple(blob, finiteScore)(reply).pipe(Effect.map(([key, score]) => ({ key, score })));

const queryResult = <A>(
  name: RedisArgument,
  filter: JsonObjectArgument,
  options: SearchQueryOptions,
  keys: boolean,
  decode: ReplyDecoder<A>,
) =>
  fromPreparation(
    Effect.gen(function* () {
      const selected = yield* queryArguments(name, filter, options, keys);
      const results: ReplyDecoder<ReadonlyArray<A>> = (reply) =>
        array(decode)(reply).pipe(
          Effect.flatMap((hits) =>
            hits.length <= selected.maximum
              ? Effect.succeed(hits)
              : Effect.fail(mismatch("array", reply)),
          ),
        );

      return yield* command("SEARCH.QUERY", nullable(results), Effect.succeed(selected.tokens))
        .prepare;
    }),
  );

export const searchQuery = (
  name: RedisArgument,
  filter: JsonObjectArgument,
  options: SearchQueryOptions = {},
) => queryResult(name, filter, options, false, contentHit);

/** A distinct builder binds the smaller reply shape to NOCONTENT in prepared wire intent. */
export const searchQueryKeys = (
  name: RedisArgument,
  filter: JsonObjectArgument,
  options: SearchKeysOptions = {},
) => queryResult(name, filter, options, true, keyHit);

export interface SearchDocumentHit<A> extends SearchKeyHit {
  readonly value: A;
}

/** JSON/STRING index documents are decoded only through an explicit application codec. */
export const searchQueryWith = <A, RD, RE>(
  name: RedisArgument,
  filter: JsonObjectArgument,
  codec: PayloadCodec<A, RD, RE>,
  options: Omit<SearchQueryOptions, "select" | "highlight"> = {},
) =>
  fromPreparation(
    parse(KeysOptions, options).pipe(
      Effect.flatMap((selected) => searchQuery(name, filter, selected).prepare),
      Effect.map((prepared) => {
        const decode: ReplyDecoder<
          Option.Option<ReadonlyArray<SearchDocumentHit<A>>>,
          PayloadError,
          RD
        > = (reply) =>
          prepared.decode(reply).pipe(
            Effect.flatMap((result) => {
              if (Option.isNone(result)) return Effect.succeed(Option.none());

              return Effect.forEach(result.value, (entry) =>
                Effect.gen(function* () {
                  const [content] = entry.content;
                  if (
                    entry.content.length !== 1 ||
                    content === undefined ||
                    content[0].length !== 1 ||
                    content[0][0] !== 36
                  )
                    return yield* mismatch("custom", reply);

                  return {
                    key: entry.key,
                    score: entry.score,
                    value: yield* codec.decode(yield* blob(content[1])),
                  };
                }),
              ).pipe(Effect.map(Option.some));
            }),
          );

        return {
          metadata: prepared.metadata,
          routing: prepared.routing,
          tokens: prepared.tokens,
          serverErrors: prepared.serverErrors,
          decode,
        };
      }),
    ),
  );
