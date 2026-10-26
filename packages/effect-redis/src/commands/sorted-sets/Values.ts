import { Effect, Option, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { nullable, pairs, tuple } from "#/command/reply/Data";
import { blob, integer, mismatch, optional, undecorate } from "#/command/reply/Scalars";
import { scoreToken } from "#/command/reply/Score";
import { keyed } from "#/commands/internal/Command";
import {
  Argument,
  Arguments,
  integer as inputInteger,
  NonNegative,
  parse,
} from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { keyedVector } from "#/commands/internal/Vector";
import { catalog } from "#/commands/sorted-sets/Catalog";
import { Score, score } from "#/commands/sorted-sets/internal/Bounds";
import { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

const AddOptions = Schema.Struct({
  condition: Schema.optionalKey(Schema.Literals(["NX", "XX"])),
  comparison: Schema.optionalKey(Schema.Literals(["GT", "LT"])),
  changed: Schema.optionalKey(Schema.Boolean),
});
export type SortedAddOptions = typeof AddOptions.Type;
export type ScoredMembers = readonly [
  readonly [Score, RedisArgument],
  ...Array<readonly [Score, RedisArgument]>,
];

const addFlags = (options: SortedAddOptions) =>
  Effect.gen(function* () {
    const o = yield* parse(AddOptions, options);
    if (o.condition === "NX" && o.comparison !== undefined)
      return yield* new CommandInputError({ delivery: "unsent", reason: "options" });
    return [
      ...(o.condition === undefined ? [] : [o.condition]),
      ...(o.comparison === undefined ? [] : [o.comparison]),
      ...(o.changed ? ["CH"] : []),
    ];
  });

export const zadd = (key: RedisArgument, entries: ScoredMembers, options: SortedAddOptions = {}) =>
  keyed(
    catalog.ZADD,
    key,
    Effect.gen(function* () {
      const values = yield* parse(Schema.NonEmptyArray(Schema.Tuple([Score, Argument])), entries);
      const flags = yield* addFlags(options);
      const encoded = yield* Effect.forEach(values, ([value, member]) =>
        score(value).pipe(Effect.map((wireScore) => [wireScore, member])),
      );
      return [...flags, ...encoded.flat()];
    }),
    integer,
    "read-write",
  );

export const zaddIncrement = (
  key: RedisArgument,
  increment: Score,
  member: RedisArgument,
  options: SortedAddOptions = {},
) =>
  keyed(
    catalog.ZADD,
    key,
    Effect.gen(function* () {
      return [...(yield* addFlags(options)), "INCR", yield* score(increment), member];
    }),
    optional(scoreToken),
    "read-write",
  );

export const zcard = (key: RedisArgument) => keyed(catalog.ZCARD, key, Effect.succeed([]), integer);

export const zincrby = (key: RedisArgument, increment: Score, member: RedisArgument) =>
  keyed(
    catalog.ZINCRBY,
    key,
    score(increment).pipe(Effect.map((n) => [n, member])),
    scoreToken,
    "read-write",
  );

export const zrem = (key: RedisArgument, members: readonly [RedisArgument, ...RedisArgument[]]) =>
  keyed(catalog.ZREM, key, parse(Arguments, members), integer, "read-write");

export const zmscore = (
  key: RedisArgument,
  members: readonly [RedisArgument, ...RedisArgument[]],
) => keyedVector(catalog.ZMSCORE, key, parse(Arguments, members), array(optional(scoreToken)));

export const zrank = (key: RedisArgument, member: RedisArgument) =>
  keyed(catalog.ZRANK, key, Effect.succeed([member]), optional(integer));

export const zrevrank = (key: RedisArgument, member: RedisArgument) =>
  keyed(catalog.ZREVRANK, key, Effect.succeed([member]), optional(integer));

export const zrankWithScore = (key: RedisArgument, member: RedisArgument) =>
  keyed(
    catalog.ZRANK,
    key,
    Effect.succeed([member, "WITHSCORE"]),
    nullable(tuple(integer, scoreToken)),
  );

export const zrevrankWithScore = (key: RedisArgument, member: RedisArgument) =>
  keyed(
    catalog.ZREVRANK,
    key,
    Effect.succeed([member, "WITHSCORE"]),
    nullable(tuple(integer, scoreToken)),
  );

export const zpopmin = (key: RedisArgument, count: Integer = 1) =>
  keyed(
    catalog.ZPOPMIN,
    key,
    parse(NonNegative, count).pipe(Effect.map((n) => [String(n)])),
    pairs(blob, scoreToken),
    "read-write",
  );

export const zpopmax = (key: RedisArgument, count: Integer = 1) =>
  keyed(
    catalog.ZPOPMAX,
    key,
    parse(NonNegative, count).pipe(Effect.map((n) => [String(n)])),
    pairs(blob, scoreToken),
    "read-write",
  );

const randomMember: ReplyDecoder<Option.Option<Uint8Array>> = (reply) => {
  const value = undecorate(reply);
  if (value._tag !== "Array") return optional(blob)(reply);

  // Dragonfly wraps the uncounted result in an array; never discard unexpected extra members.
  if (value.values.length === 0) return Effect.succeed(Option.none());
  const member = value.values[0];
  return value.values.length === 1 && member !== undefined
    ? blob(member).pipe(Effect.map(Option.some))
    : Effect.fail(mismatch("array-length", reply));
};

export const zrandmember = (key: RedisArgument) =>
  keyed(catalog.ZRANDMEMBER, key, Effect.succeed([]), randomMember);

export const zrandmemberCount = (key: RedisArgument, count: Integer) =>
  keyed(catalog.ZRANDMEMBER, key, inputInteger(count).pipe(Effect.map((n) => [n])), array(blob));

export const zrandmemberWithScores = (key: RedisArgument, count: Integer) =>
  keyed(
    catalog.ZRANDMEMBER,
    key,
    inputInteger(count).pipe(Effect.map((n) => [n, "WITHSCORES"])),
    pairs(blob, scoreToken),
  );
