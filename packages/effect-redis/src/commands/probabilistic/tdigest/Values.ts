import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { integer, status } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { Finite, NonNegative, parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { keyedVector } from "#/commands/internal/Vector";
import { moduleKeyed, moduleMetadata } from "#/commands/modules/Build";
import { moduleDouble } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

export const tdigestCreate = (
  key: RedisArgument,
  options: { readonly compression?: Integer } = {},
) =>
  moduleKeyed(
    "probabilistic",
    "TDIGEST.CREATE",
    key,
    status("OK"),
    parse(Schema.Struct({ compression: Schema.optionalKey(Positive) }), options).pipe(
      Effect.map((selected) =>
        selected.compression === undefined ? [] : ["COMPRESSION", String(selected.compression)],
      ),
    ),
    "write",
  );
export const tdigestReset = (key: RedisArgument) =>
  moduleKeyed(
    "probabilistic",
    "TDIGEST.RESET",
    key,
    status("OK"),
    Effect.succeed([]),
    "read-write",
  );
export const tdigestInfo = (key: RedisArgument) =>
  moduleKeyed("probabilistic", "TDIGEST.INFO", key, fields);
export const tdigestMin = (key: RedisArgument) =>
  moduleKeyed("probabilistic", "TDIGEST.MIN", key, moduleDouble);
export const tdigestMax = (key: RedisArgument) =>
  moduleKeyed("probabilistic", "TDIGEST.MAX", key, moduleDouble);
export const tdigestAdd = (key: RedisArgument, values: readonly [number, ...number[]]) =>
  moduleKeyed(
    "probabilistic",
    "TDIGEST.ADD",
    key,
    status("OK"),
    parse(Schema.NonEmptyArray(Finite), values).pipe(Effect.map((entries) => entries.map(String))),
    "read-write",
  );

export const tdigestQuantile = (key: RedisArgument, quantiles: readonly [number, ...number[]]) =>
  keyedVector(
    moduleMetadata("probabilistic", "TDIGEST.QUANTILE"),
    key,
    parse(
      Schema.NonEmptyArray(Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
      quantiles,
    ).pipe(Effect.map((entries) => entries.map(String))),
    array(moduleDouble),
  );
export const tdigestCdf = (key: RedisArgument, values: readonly [number, ...number[]]) =>
  keyedVector(
    moduleMetadata("probabilistic", "TDIGEST.CDF"),
    key,
    parse(Schema.NonEmptyArray(Finite), values).pipe(Effect.map((entries) => entries.map(String))),
    array(moduleDouble),
  );
export const tdigestRank = (key: RedisArgument, values: readonly [number, ...number[]]) =>
  keyedVector(
    moduleMetadata("probabilistic", "TDIGEST.RANK"),
    key,
    parse(Schema.NonEmptyArray(Finite), values).pipe(Effect.map((entries) => entries.map(String))),
    array(integer),
  );
export const tdigestRevrank = (key: RedisArgument, values: readonly [number, ...number[]]) =>
  keyedVector(
    moduleMetadata("probabilistic", "TDIGEST.REVRANK"),
    key,
    parse(Schema.NonEmptyArray(Finite), values).pipe(Effect.map((entries) => entries.map(String))),
    array(integer),
  );
export const tdigestByrank = (key: RedisArgument, ranks: readonly [Integer, ...Integer[]]) =>
  keyedVector(
    moduleMetadata("probabilistic", "TDIGEST.BYRANK"),
    key,
    parse(Schema.NonEmptyArray(NonNegative), ranks).pipe(
      Effect.map((entries) => entries.map(String)),
    ),
    array(moduleDouble),
  );
export const tdigestByrevrank = (key: RedisArgument, ranks: readonly [Integer, ...Integer[]]) =>
  keyedVector(
    moduleMetadata("probabilistic", "TDIGEST.BYREVRANK"),
    key,
    parse(Schema.NonEmptyArray(NonNegative), ranks).pipe(
      Effect.map((entries) => entries.map(String)),
    ),
    array(moduleDouble),
  );
export const tdigestTrimmedMean = (key: RedisArgument, low: number, high: number) =>
  moduleKeyed(
    "probabilistic",
    "TDIGEST.TRIMMED_MEAN",
    key,
    moduleDouble,
    Effect.gen(function* () {
      const bounds = yield* parse(Schema.Tuple([Finite, Finite]), [low, high]);
      if (bounds[0] < 0 || bounds[1] > 1 || bounds[0] >= bounds[1])
        return yield* parse(Schema.Never, bounds);
      return bounds.map(String);
    }),
  );
