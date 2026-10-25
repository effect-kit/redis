import { Effect } from "effect";

import { array } from "#/command/reply/Collections";
import { boolean, members } from "#/command/reply/Data";
import { blob, integer, optional } from "#/command/reply/Scalars";
import { keyed, keyIndexes, ordinary } from "#/commands/internal/Command";
import { Arguments, integer as inputInteger, nonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { keyedVector } from "#/commands/internal/Vector";
import { catalog } from "#/commands/sets/Catalog";
import type { RedisArgument } from "#/RedisArgument";

export type SetMembers = readonly [RedisArgument, ...RedisArgument[]];

export const sadd = (key: RedisArgument, values: SetMembers) =>
  keyed(catalog.SADD, key, parse(Arguments, values), integer, "read-write");

export const srem = (key: RedisArgument, values: SetMembers) =>
  keyed(catalog.SREM, key, parse(Arguments, values), integer, "read-write");

export const scard = (key: RedisArgument) => keyed(catalog.SCARD, key, Effect.succeed([]), integer);

export const smembers = (key: RedisArgument) =>
  keyed(catalog.SMEMBERS, key, Effect.succeed([]), members(blob));

export const sismember = (key: RedisArgument, value: RedisArgument) =>
  keyed(catalog.SISMEMBER, key, Effect.succeed([value]), boolean);

export const smismember = (key: RedisArgument, values: SetMembers) =>
  keyedVector(catalog.SMISMEMBER, key, parse(Arguments, values), array(boolean));

export const spop = (key: RedisArgument) =>
  keyed(catalog.SPOP, key, Effect.succeed([]), optional(blob), "read-write");

export const spopCount = (key: RedisArgument, count: Integer) =>
  keyed(
    catalog.SPOP,
    key,
    nonNegative(count).pipe(Effect.map((n) => [n])),
    members(blob),
    "read-write",
  );

export const srandmember = (key: RedisArgument) =>
  keyed(catalog.SRANDMEMBER, key, Effect.succeed([]), optional(blob));

export const srandmemberCount = (key: RedisArgument, count: Integer) =>
  keyed(catalog.SRANDMEMBER, key, inputInteger(count).pipe(Effect.map((n) => [n])), array(blob));

export const smove = (source: RedisArgument, destination: RedisArgument, value: RedisArgument) =>
  ordinary(
    catalog.SMOVE,
    boolean,
    Effect.succeed({
      tokens: ["SMOVE", source, destination, value],
      routing: keyIndexes([1, 2], "read-write"),
    }),
  );
