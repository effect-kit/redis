import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { boolean, nullable, pairs, simpleText, unsigned } from "#/command/reply/Data";
import { integer, mismatch } from "#/command/reply/Scalars";
import { parse } from "#/commands/internal/Input";
import { command, Name, named } from "#/commands/upstash/Build";
import type { JsonObjectArgument } from "#/commands/upstash/JsonArgument";
import { jsonArgument } from "#/commands/upstash/JsonArgument";
import { field, fields, literal } from "#/commands/upstash/Reply";
import type { RedisArgument } from "#/RedisArgument";

const Type = literal(["JSON", "HASH", "STRING", "STREAM"]);

const description = (reply: Parameters<typeof fields>[0]) =>
  Effect.gen(function* () {
    const entries = yield* fields(reply);
    return {
      name: yield* simpleText(yield* field(entries, "name", reply)),
      type: yield* Type(yield* field(entries, "type", reply)),
      prefixes: yield* array(simpleText)(yield* field(entries, "prefixes", reply)),
      language: yield* simpleText(yield* field(entries, "language", reply)),
      indexSize: yield* unsigned(yield* field(entries, "indexSize", reply)),
      pendingUpdates: yield* unsigned(yield* field(entries, "pendingUpdates", reply)),
      schema: yield* array(Effect.succeed)(yield* field(entries, "schema", reply)),
    };
  });

export const searchDescribe = (name: RedisArgument) =>
  named("SEARCH.DESCRIBE", name, nullable(description));
export const searchDrop = (name: RedisArgument) => named("SEARCH.DROP", name, boolean);
export const searchWaitIndexing = (name: RedisArgument) =>
  named("SEARCH.WAITINDEXING", name, boolean);

const List = Schema.Struct({
  match: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type SearchListOptions = typeof List.Type;

export const searchListIndexes = (options: SearchListOptions = {}) =>
  command(
    "SEARCH.LISTINDEXES",
    array((reply) =>
      Effect.gen(function* () {
        const entries = yield* fields(reply);
        return {
          name: yield* simpleText(yield* field(entries, "name", reply)),
          type: yield* Type(yield* field(entries, "type", reply)),
        };
      }),
    ),
    parse(List, options).pipe(
      Effect.map((selected) => [
        ...(selected.match === undefined ? [] : ["MATCH", selected.match]),
        ...(selected.limit === undefined ? [] : ["LIMIT", String(selected.limit)]),
        ...(selected.offset === undefined ? [] : ["OFFSET", String(selected.offset)]),
      ]),
    ),
  );

const aliasResult: ReplyDecoder<1 | 2> = (reply) =>
  integer(reply).pipe(
    Effect.flatMap((value) =>
      value === 1n || value === 2n
        ? Effect.succeed(value === 1n ? 1 : 2)
        : Effect.fail(mismatch("integer", reply)),
    ),
  );

/** 1 creates an alias; 2 updates its target, including an unchanged target. */
export const searchAliasAdd = (alias: RedisArgument, index: RedisArgument) =>
  command("SEARCH.ALIASADD", aliasResult, Effect.all([parse(Name, alias), parse(Name, index)]));
export const searchAliasDel = (alias: RedisArgument) => named("SEARCH.ALIASDEL", alias, boolean);
export const searchListAliases = () =>
  command("SEARCH.LISTALIASES", pairs(simpleText, simpleText), Effect.succeed([]));

/** -1 is the provider's missing-index sentinel, distinct from an empty result count. */
export const searchCount = (name: RedisArgument, filter: JsonObjectArgument) =>
  command("SEARCH.COUNT", integer, Effect.all([parse(Name, name), jsonArgument(filter)]));

/** Dynamic aggregation aliases and opaque afterKey values remain lossless RESP values. */
export const searchAggregate = (
  name: RedisArgument,
  filter: JsonObjectArgument,
  aggregations: JsonObjectArgument,
) =>
  command(
    "SEARCH.AGGREGATE",
    nullable(fields),
    Effect.all([parse(Name, name), jsonArgument(filter), jsonArgument(aggregations)]),
  );
