import { Effect, Schema } from "effect";

import { boolean, decimalToken } from "#/command/reply/Data";
import { blob, integer as integerReply, optional } from "#/command/reply/Scalars";
import { keyed } from "#/commands/internal/Command";
import { expiryTokens } from "#/commands/internal/Expiry";
import type { Expiry } from "#/commands/internal/Expiry";
import { decimal, integer, nonNegative, parse } from "#/commands/internal/Input";
import type { Decimal, Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/strings/Catalog";
import type { RedisArgument } from "#/RedisArgument";

export const append = (key: RedisArgument, value: RedisArgument) =>
  keyed(catalog.APPEND, key, Effect.succeed([value]), integerReply, "read-write");

export const strlen = (key: RedisArgument) =>
  keyed(catalog.STRLEN, key, Effect.succeed([]), integerReply);

export const getdel = (key: RedisArgument) =>
  keyed(catalog.GETDEL, key, Effect.succeed([]), optional(blob), "read-write");

export const getset = (key: RedisArgument, value: RedisArgument) =>
  keyed(catalog.GETSET, key, Effect.succeed([value]), optional(blob), "read-write");

export const getex = (key: RedisArgument, expiry?: Expiry) =>
  keyed(catalog.GETEX, key, expiryTokens(expiry), optional(blob), "read-write");

export const getrange = (key: RedisArgument, start: Integer, end: Integer) =>
  keyed(catalog.GETRANGE, key, Effect.all([integer(start), integer(end)]), blob);

export const substr = (key: RedisArgument, start: Integer, end: Integer) =>
  keyed(catalog.SUBSTR, key, Effect.all([integer(start), integer(end)]), blob);

export const setrange = (key: RedisArgument, offset: Integer, value: RedisArgument) =>
  keyed(
    catalog.SETRANGE,
    key,
    nonNegative(offset).pipe(Effect.map((n) => [n, value])),
    integerReply,
    "read-write",
  );

export const incrby = (key: RedisArgument, increment: Integer) =>
  keyed(
    catalog.INCRBY,
    key,
    integer(increment).pipe(Effect.map((n) => [n])),
    integerReply,
    "read-write",
  );

export const decr = (key: RedisArgument) =>
  keyed(catalog.DECR, key, Effect.succeed([]), integerReply, "read-write");

export const decrby = (key: RedisArgument, decrement: Integer) =>
  keyed(
    catalog.DECRBY,
    key,
    integer(decrement).pipe(Effect.map((n) => [n])),
    integerReply,
    "read-write",
  );

/** Decimal wire text avoids an implicit lossy JavaScript number conversion. */
export const incrbyfloat = (key: RedisArgument, increment: Decimal) =>
  keyed(
    catalog.INCRBYFLOAT,
    key,
    decimal(increment).pipe(Effect.map((n) => [n])),
    decimalToken,
    "read-write",
  );

export const digest = (key: RedisArgument) =>
  keyed(catalog.DIGEST, key, Effect.succeed([]), optional(blob));

export const delifeq = (key: RedisArgument, value: RedisArgument) =>
  keyed(catalog.DELIFEQ, key, Effect.succeed([value]), boolean, "read-write");

const DeleteCondition = Schema.Struct({
  type: Schema.Literals(["IFEQ", "IFNE", "IFDEQ", "IFDNE"]),
  value: Schema.Union([Schema.String, Schema.Uint8Array]),
});

export type DeleteCondition = typeof DeleteCondition.Type;

export const delex = (key: RedisArgument, condition?: DeleteCondition) =>
  keyed(
    catalog.DELEX,
    key,
    condition === undefined
      ? Effect.succeed([])
      : parse(DeleteCondition, condition).pipe(Effect.map((c) => [c.type, c.value])),
    boolean,
    "read-write",
  );
