import { Effect, Redacted, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { members, nullable, pairs, simpleText, unsigned, withLength } from "#/command/reply/Data";
import { blob, status } from "#/command/reply/Scalars";
import { Arguments, NonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyless } from "#/commands/modules/Build";
import { configHelp } from "#/commands/search/reply/Configuration";
import { searchFields } from "#/commands/search/reply/Fields";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisArgument } from "#/RedisArgument";

export const ftAliasadd = (alias: RedisArgument, index: RedisArgument) =>
  moduleKeyless("search", "FT.ALIASADD", status("OK"), Effect.succeed([alias, index]));
export const ftAliasupdate = (alias: RedisArgument, index: RedisArgument) =>
  moduleKeyless("search", "FT.ALIASUPDATE", status("OK"), Effect.succeed([alias, index]));
export const ftAliasdel = (alias: RedisArgument) =>
  moduleKeyless("search", "FT.ALIASDEL", status("OK"), Effect.succeed([alias]));
export const ftAliaslist = (index: RedisArgument) =>
  moduleKeyless("search", "FT.ALIASLIST", members(blob), Effect.succeed([index]));
export const ftDictadd = (
  dictionary: RedisArgument,
  terms: readonly [RedisArgument, ...RedisArgument[]],
) =>
  moduleKeyless(
    "search",
    "FT.DICTADD",
    unsigned,
    parse(Arguments, terms).pipe(Effect.map((selected) => [dictionary, ...selected])),
  );
export const ftDictdel = (
  dictionary: RedisArgument,
  terms: readonly [RedisArgument, ...RedisArgument[]],
) =>
  moduleKeyless(
    "search",
    "FT.DICTDEL",
    unsigned,
    parse(Arguments, terms).pipe(Effect.map((selected) => [dictionary, ...selected])),
  );
export const ftDictdump = (dictionary: RedisArgument) =>
  moduleKeyless("search", "FT.DICTDUMP", members(blob), Effect.succeed([dictionary]));
export const ftSynupdate = (
  index: RedisArgument,
  group: RedisArgument,
  terms: readonly [RedisArgument, ...RedisArgument[]],
  options: { readonly skipInitialScan?: boolean } = {},
) =>
  moduleKeyless(
    "search",
    "FT.SYNUPDATE",
    status("OK"),
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({ skipInitialScan: Schema.optionalKey(Schema.Boolean) }),
        options,
      );
      const entries = yield* parse(Arguments, terms);
      return [index, group, ...(selected.skipInitialScan ? ["SKIPINITIALSCAN"] : []), ...entries];
    }),
  );
export const ftSyndump = (index: RedisArgument) =>
  moduleKeyless("search", "FT.SYNDUMP", pairs(blob, array(simpleText)), Effect.succeed([index]));
export const ftTagvals = (index: RedisArgument, field: RedisArgument) =>
  moduleKeyless("search", "FT.TAGVALS", members(blob), Effect.succeed([index, field]));
export const ftExplain = (index: RedisArgument, query: RedisArgument, dialect?: Integer) =>
  moduleKeyless(
    "search",
    "FT.EXPLAIN",
    simpleText,
    dialect === undefined
      ? Effect.succeed([index, query])
      : parse(NonNegative, dialect).pipe(Effect.map((n) => [index, query, "DIALECT", String(n)])),
  );
export const ftExplaincli = (index: RedisArgument, query: RedisArgument, dialect?: Integer) =>
  moduleKeyless(
    "search",
    "FT.EXPLAINCLI",
    array(simpleText),
    dialect === undefined
      ? Effect.succeed([index, query])
      : parse(NonNegative, dialect).pipe(Effect.map((n) => [index, query, "DIALECT", String(n)])),
  );
/** Legacy document commands are explicit; modern indexing normally follows HASH/JSON writes. */
export const ftGet = (index: RedisArgument, key: RedisArgument) =>
  moduleKeyless("search", "FT.GET", nullable(searchFields), Effect.succeed([index, key]));
export const ftMget = (
  index: RedisArgument,
  keys: readonly [RedisArgument, ...RedisArgument[]],
) => ({
  prepare: Effect.gen(function* () {
    const selected = yield* parse(Arguments, keys);
    return yield* moduleKeyless(
      "search",
      "FT.MGET",
      withLength(selected.length, array(nullable(searchFields))),
      Effect.succeed([index, ...selected]),
    ).prepare;
  }),
});

const configFields = (reply: RespValue) =>
  pairs(simpleText, nullable(simpleText))(reply).pipe(Effect.map(Redacted.make));
export const ftConfigGet = (name: RedisArgument) =>
  moduleKeyless("search", "FT.CONFIG GET", configFields, Effect.succeed([name]));
export const ftConfigSet = (name: RedisArgument, value: Redacted.Redacted<RedisArgument>) =>
  moduleKeyless(
    "search",
    "FT.CONFIG SET",
    status("OK"),
    Effect.suspend(() => Effect.succeed([name, Redacted.value(value)])),
  );

export const ftConfigHelp = (pattern: RedisArgument = "*") =>
  moduleKeyless("search", "FT.CONFIG HELP", configHelp, Effect.succeed([pattern]));
