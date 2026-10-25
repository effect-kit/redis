import { Effect, Schema } from "effect";

import { boolean } from "#/command/reply/Data";
import { integer } from "#/command/reply/Scalars";
import { keyed } from "#/commands/internal/Command";
import { integer as inputInteger, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/keys/Catalog";
import type { RedisArgument } from "#/RedisArgument";

export type KeyExpireCondition = "NX" | "XX" | "GT" | "LT";

const expiry = (
  name: "EXPIRE" | "PEXPIRE" | "EXPIREAT" | "PEXPIREAT",
  key: RedisArgument,
  time: Integer,
  condition?: KeyExpireCondition,
) =>
  keyed(
    catalog[name],
    key,
    Effect.gen(function* () {
      const value = yield* inputInteger(time);
      const mode =
        condition === undefined
          ? []
          : [yield* parse(Schema.Literals(["NX", "XX", "GT", "LT"]), condition)];
      return [value, ...mode];
    }),
    boolean,
    "read-write",
  );

export const expire = (key: RedisArgument, seconds: Integer, condition?: KeyExpireCondition) =>
  expiry("EXPIRE", key, seconds, condition);

export const pexpire = (
  key: RedisArgument,
  milliseconds: Integer,
  condition?: KeyExpireCondition,
) => expiry("PEXPIRE", key, milliseconds, condition);

export const expireat = (key: RedisArgument, timestamp: Integer, condition?: KeyExpireCondition) =>
  expiry("EXPIREAT", key, timestamp, condition);

export const pexpireat = (key: RedisArgument, timestamp: Integer, condition?: KeyExpireCondition) =>
  expiry("PEXPIREAT", key, timestamp, condition);

/** -2 means absent, -1 means persistent; nonnegative values use the command's named unit. */
export const ttl = (key: RedisArgument) => keyed(catalog.TTL, key, Effect.succeed([]), integer);

export const pttl = (key: RedisArgument) => keyed(catalog.PTTL, key, Effect.succeed([]), integer);

export const expiretime = (key: RedisArgument) =>
  keyed(catalog.EXPIRETIME, key, Effect.succeed([]), integer);

export const pexpiretime = (key: RedisArgument) =>
  keyed(catalog.PEXPIRETIME, key, Effect.succeed([]), integer);

export const persist = (key: RedisArgument) =>
  keyed(catalog.PERSIST, key, Effect.succeed([]), boolean, "read-write");
