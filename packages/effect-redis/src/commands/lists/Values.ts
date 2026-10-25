import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { nullable } from "#/command/reply/Data";
import { blob, integer, optional, status } from "#/command/reply/Scalars";
import { keyed } from "#/commands/internal/Command";
import {
  Arguments,
  Integer,
  integer as inputInteger,
  nonNegative,
  NonNegative,
  parse,
} from "#/commands/internal/Input";
import { catalog } from "#/commands/lists/Catalog";
import type { RedisArgument } from "#/RedisArgument";

export type ListValues = readonly [RedisArgument, ...RedisArgument[]];

export const lpush = (key: RedisArgument, values: ListValues) =>
  keyed(catalog.LPUSH, key, parse(Arguments, values), integer, "read-write");

export const rpush = (key: RedisArgument, values: ListValues) =>
  keyed(catalog.RPUSH, key, parse(Arguments, values), integer, "read-write");

export const lpushx = (key: RedisArgument, values: ListValues) =>
  keyed(catalog.LPUSHX, key, parse(Arguments, values), integer, "read-write");

export const rpushx = (key: RedisArgument, values: ListValues) =>
  keyed(catalog.RPUSHX, key, parse(Arguments, values), integer, "read-write");

export const llen = (key: RedisArgument) => keyed(catalog.LLEN, key, Effect.succeed([]), integer);

export const lindex = (key: RedisArgument, index: Integer) =>
  keyed(catalog.LINDEX, key, inputInteger(index).pipe(Effect.map((n) => [n])), optional(blob));

export const lrange = (key: RedisArgument, start: Integer, end: Integer) =>
  keyed(catalog.LRANGE, key, Effect.all([inputInteger(start), inputInteger(end)]), array(blob));

export const ltrim = (key: RedisArgument, start: Integer, end: Integer) =>
  keyed(
    catalog.LTRIM,
    key,
    Effect.all([inputInteger(start), inputInteger(end)]),
    status("OK"),
    "read-write",
  );

export const lset = (key: RedisArgument, index: Integer, value: RedisArgument) =>
  keyed(
    catalog.LSET,
    key,
    inputInteger(index).pipe(Effect.map((n) => [n, value])),
    status("OK"),
    "read-write",
  );

export const lrem = (key: RedisArgument, count: Integer, value: RedisArgument) =>
  keyed(
    catalog.LREM,
    key,
    inputInteger(count).pipe(Effect.map((n) => [n, value])),
    integer,
    "read-write",
  );

export const linsert = (
  key: RedisArgument,
  position: "BEFORE" | "AFTER",
  pivot: RedisArgument,
  value: RedisArgument,
) =>
  keyed(
    catalog.LINSERT,
    key,
    parse(Schema.Literals(["BEFORE", "AFTER"]), position).pipe(
      Effect.map((mode) => [mode, pivot, value]),
    ),
    integer,
    "read-write",
  );

export const lpop = (key: RedisArgument) =>
  keyed(catalog.LPOP, key, Effect.succeed([]), optional(blob), "read-write");

export const rpop = (key: RedisArgument) =>
  keyed(catalog.RPOP, key, Effect.succeed([]), optional(blob), "read-write");

/** A count changes the reply from an optional element to an optional aggregate. */
export const lpopCount = (key: RedisArgument, count: Integer) =>
  keyed(
    catalog.LPOP,
    key,
    nonNegative(count).pipe(Effect.map((n) => [n])),
    nullable(array(blob)),
    "read-write",
  );

export const rpopCount = (key: RedisArgument, count: Integer) =>
  keyed(
    catalog.RPOP,
    key,
    nonNegative(count).pipe(Effect.map((n) => [n])),
    nullable(array(blob)),
    "read-write",
  );

const PositionOptions = Schema.Struct({
  rank: Schema.optionalKey(Integer.check(Schema.makeFilter((n) => n !== 0 && n !== 0n))),
  maxLength: Schema.optionalKey(NonNegative),
});
export type PositionOptions = typeof PositionOptions.Type;

const positionTokens = (options: PositionOptions) =>
  parse(PositionOptions, options).pipe(
    Effect.map((o) => [
      ...(o.rank === undefined ? [] : ["RANK", String(o.rank)]),
      ...(o.maxLength === undefined ? [] : ["MAXLEN", String(o.maxLength)]),
    ]),
  );

export const lpos = (key: RedisArgument, value: RedisArgument, options: PositionOptions = {}) =>
  keyed(
    catalog.LPOS,
    key,
    positionTokens(options).pipe(Effect.map((tail) => [value, ...tail])),
    optional(integer),
  );

export const lposCount = (
  key: RedisArgument,
  value: RedisArgument,
  count: Integer,
  options: PositionOptions = {},
) =>
  keyed(
    catalog.LPOS,
    key,
    Effect.gen(function* () {
      return [value, "COUNT", yield* nonNegative(count), ...(yield* positionTokens(options))];
    }),
    array(integer),
  );
