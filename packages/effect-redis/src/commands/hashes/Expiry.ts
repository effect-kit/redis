import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { boolean } from "#/command/reply/Data";
import { blob, integer, optional } from "#/command/reply/Scalars";
import { catalog } from "#/commands/hashes/Catalog";
import { keyed } from "#/commands/internal/Command";
import { expiryTokens } from "#/commands/internal/Expiry";
import type { Expiry } from "#/commands/internal/Expiry";
import { Arguments, integer as inputInteger, parse, Pairs } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { KeyValues } from "#/commands/strings/Multiple";
import { SetExpiry } from "#/commands/strings/SetOptions";
import type { RedisArgument } from "#/RedisArgument";

export type Fields = readonly [RedisArgument, ...RedisArgument[]];
export type ExpireCondition = "NX" | "XX" | "GT" | "LT";
const Condition = Schema.Literals(["NX", "XX", "GT", "LT"]);
const fieldTokens = (fields: Fields) =>
  parse(Arguments, fields).pipe(
    Effect.map((values) => ["FIELDS", String(values.length), ...values]),
  );

const expireFields = (
  name: "HEXPIRE" | "HPEXPIRE" | "HEXPIREAT" | "HPEXPIREAT",
  key: RedisArgument,
  time: Integer,
  fields: Fields,
  condition?: ExpireCondition,
) =>
  keyed(
    catalog[name],
    key,
    Effect.gen(function* () {
      const duration = yield* inputInteger(time);
      const mode = condition === undefined ? [] : [yield* parse(Condition, condition)];
      return [duration, ...mode, ...(yield* fieldTokens(fields))];
    }),
    array(integer),
    "read-write",
  );

export const hexpire = (
  key: RedisArgument,
  seconds: Integer,
  fields: Fields,
  condition?: ExpireCondition,
) => expireFields("HEXPIRE", key, seconds, fields, condition);
export const hpexpire = (
  key: RedisArgument,
  milliseconds: Integer,
  fields: Fields,
  condition?: ExpireCondition,
) => expireFields("HPEXPIRE", key, milliseconds, fields, condition);
export const hexpireat = (
  key: RedisArgument,
  timestamp: Integer,
  fields: Fields,
  condition?: ExpireCondition,
) => expireFields("HEXPIREAT", key, timestamp, fields, condition);
export const hpexpireat = (
  key: RedisArgument,
  timestamp: Integer,
  fields: Fields,
  condition?: ExpireCondition,
) => expireFields("HPEXPIREAT", key, timestamp, fields, condition);

/** Negative TTL and persistence status codes remain exact per-field integers, in request order. */
export const httl = (key: RedisArgument, fields: Fields) =>
  keyed(catalog.HTTL, key, fieldTokens(fields), array(integer));
export const hpttl = (key: RedisArgument, fields: Fields) =>
  keyed(catalog.HPTTL, key, fieldTokens(fields), array(integer));
export const hexpiretime = (key: RedisArgument, fields: Fields) =>
  keyed(catalog.HEXPIRETIME, key, fieldTokens(fields), array(integer));
export const hpexpiretime = (key: RedisArgument, fields: Fields) =>
  keyed(catalog.HPEXPIRETIME, key, fieldTokens(fields), array(integer));
export const hpersist = (key: RedisArgument, fields: Fields) =>
  keyed(catalog.HPERSIST, key, fieldTokens(fields), array(integer), "read-write");
export const hgetdel = (key: RedisArgument, fields: Fields) =>
  keyed(catalog.HGETDEL, key, fieldTokens(fields), array(optional(blob)), "read-write");
export const hgetex = (key: RedisArgument, fields: Fields, expiry?: Expiry) =>
  keyed(
    catalog.HGETEX,
    key,
    Effect.gen(function* () {
      return [...(yield* expiryTokens(expiry)), ...(yield* fieldTokens(fields))];
    }),
    array(optional(blob)),
    "read-write",
  );

const Options = Schema.Struct({
  keyCondition: Schema.optionalKey(Schema.Literals(["NX", "XX"])),
  condition: Schema.optionalKey(Schema.Literals(["FNX", "FXX"])),
  expiry: Schema.optionalKey(SetExpiry),
});
export type HashSetExpiryOptions = typeof Options.Type;
export const hsetex = (
  key: RedisArgument,
  entries: KeyValues,
  options: HashSetExpiryOptions = {},
) =>
  keyed(
    catalog.HSETEX,
    key,
    Effect.gen(function* () {
      const values = yield* parse(Pairs, entries);
      const parsed = yield* parse(Options, options);
      const tail: RedisArgument[] = [];
      // NX/XX is a Valkey HSETEX extension, distinct from field-level FNX/FXX.
      if (parsed.keyCondition !== undefined) tail.push(parsed.keyCondition);
      if (parsed.condition !== undefined) tail.push(parsed.condition);
      if (parsed.expiry !== undefined) {
        tail.push(parsed.expiry.type);
        if (parsed.expiry.type !== "KEEPTTL") tail.push(String(parsed.expiry.value));
      }
      return [...tail, "FIELDS", String(values.length), ...values.flat()];
    }),
    boolean,
    "read-write",
  );
