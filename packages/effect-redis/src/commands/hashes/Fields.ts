import { Effect } from "effect";

import { array } from "#/command/reply/Collections";
import { boolean, decimalToken, pairs } from "#/command/reply/Data";
import { blob, integer, optional, status, text } from "#/command/reply/Scalars";
import { catalog } from "#/commands/hashes/Catalog";
import { keyed } from "#/commands/internal/Command";
import {
  Arguments,
  decimal,
  integer as inputInteger,
  parse,
  Pairs,
} from "#/commands/internal/Input";
import type { Decimal, Integer } from "#/commands/internal/Input";
import { keyedVector } from "#/commands/internal/Vector";
import type { KeyValues } from "#/commands/strings/Multiple";
import type { RedisArgument } from "#/RedisArgument";

export const hget = (key: RedisArgument, field: RedisArgument) =>
  keyed(catalog.HGET, key, Effect.succeed([field]), optional(blob));

export const hgetText = (key: RedisArgument, field: RedisArgument) =>
  keyed(catalog.HGET, key, Effect.succeed([field]), optional(text));

export const hgetall = (key: RedisArgument) =>
  keyed(catalog.HGETALL, key, Effect.succeed([]), pairs(blob, blob));

export const hkeys = (key: RedisArgument) =>
  keyed(catalog.HKEYS, key, Effect.succeed([]), array(blob));

export const hvals = (key: RedisArgument) =>
  keyed(catalog.HVALS, key, Effect.succeed([]), array(blob));

export const hlen = (key: RedisArgument) => keyed(catalog.HLEN, key, Effect.succeed([]), integer);

export const hstrlen = (key: RedisArgument, field: RedisArgument) =>
  keyed(catalog.HSTRLEN, key, Effect.succeed([field]), integer);

export const hexists = (key: RedisArgument, field: RedisArgument) =>
  keyed(catalog.HEXISTS, key, Effect.succeed([field]), boolean);

export const hset = (key: RedisArgument, entries: KeyValues) =>
  keyed(
    catalog.HSET,
    key,
    parse(Pairs, entries).pipe(Effect.map((fields) => fields.flat())),
    integer,
    "read-write",
  );

export const hmset = (key: RedisArgument, entries: KeyValues) =>
  keyed(
    catalog.HMSET,
    key,
    parse(Pairs, entries).pipe(Effect.map((fields) => fields.flat())),
    status("OK"),
    "write",
  );

export const hsetnx = (key: RedisArgument, field: RedisArgument, value: RedisArgument) =>
  keyed(catalog.HSETNX, key, Effect.succeed([field, value]), boolean, "read-write");

export const hdel = (key: RedisArgument, fields: readonly [RedisArgument, ...RedisArgument[]]) =>
  keyed(catalog.HDEL, key, parse(Arguments, fields), integer, "read-write");

export const hmget = (key: RedisArgument, fields: readonly [RedisArgument, ...RedisArgument[]]) =>
  keyedVector(catalog.HMGET, key, parse(Arguments, fields), array(optional(blob)));

export const hincrby = (key: RedisArgument, field: RedisArgument, amount: Integer) =>
  keyed(
    catalog.HINCRBY,
    key,
    inputInteger(amount).pipe(Effect.map((n) => [field, n])),
    integer,
    "read-write",
  );

export const hincrbyfloat = (key: RedisArgument, field: RedisArgument, amount: Decimal) =>
  keyed(
    catalog.HINCRBYFLOAT,
    key,
    decimal(amount).pipe(Effect.map((n) => [field, n])),
    decimalToken,
    "read-write",
  );

export const hrandfield = (key: RedisArgument) =>
  keyed(catalog.HRANDFIELD, key, Effect.succeed([]), optional(blob));

export const hrandfieldCount = (key: RedisArgument, count: Integer) =>
  keyed(catalog.HRANDFIELD, key, inputInteger(count).pipe(Effect.map((n) => [n])), array(blob));

export const hrandfieldWithValues = (key: RedisArgument, count: Integer) =>
  keyed(
    catalog.HRANDFIELD,
    key,
    inputInteger(count).pipe(Effect.map((n) => [n, "WITHVALUES"])),
    pairs(blob, blob),
  );
