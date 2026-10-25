import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { tuple, unsigned } from "#/command/reply/Data";
import { decimalToken } from "#/command/reply/Data";
import { blob, integer, optional } from "#/command/reply/Scalars";
import { catalog } from "#/commands/arrays/Catalog";
import { ArrayIndex, index } from "#/commands/arrays/internal/Index";
import { keyed } from "#/commands/internal/Command";
import { Argument, parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export const arop = (
  key: RedisArgument,
  start: ArrayIndex,
  end: ArrayIndex,
  operation: "SUM" | "MIN" | "MAX",
) =>
  keyed(
    catalog.AROP,
    key,
    Effect.gen(function* () {
      return [
        yield* index(start),
        yield* index(end),
        yield* parse(Schema.Literals(["SUM", "MIN", "MAX"]), operation),
      ];
    }),
    optional(decimalToken),
  );

export const aropInteger = (
  key: RedisArgument,
  start: ArrayIndex,
  end: ArrayIndex,
  operation: "AND" | "OR" | "XOR" | "USED",
) =>
  keyed(
    catalog.AROP,
    key,
    Effect.gen(function* () {
      return [
        yield* index(start),
        yield* index(end),
        yield* parse(Schema.Literals(["AND", "OR", "XOR", "USED"]), operation),
      ];
    }),
    optional(integer),
  );

export const aropMatch = (
  key: RedisArgument,
  start: ArrayIndex,
  end: ArrayIndex,
  value: RedisArgument,
) =>
  keyed(
    catalog.AROP,
    key,
    Effect.gen(function* () {
      return [yield* index(start), yield* index(end), "MATCH", value];
    }),
    integer,
  );

const Bound = Schema.Union([ArrayIndex, Schema.Literals(["-", "+"])]);
const Predicate = Schema.Struct({
  type: Schema.Literals(["EXACT", "MATCH", "GLOB", "RE"]),
  value: Argument,
});
const Options = Schema.Struct({
  combine: Schema.optionalKey(Schema.Literals(["AND", "OR"])),
  limit: Schema.optionalKey(ArrayIndex),
  noCase: Schema.optionalKey(Schema.Boolean),
});
export type ArrayPredicate = typeof Predicate.Type;
export type ArraySearchOptions = typeof Options.Type;
export type ArraySearchBound = typeof Bound.Type;

const grep = (
  start: ArraySearchBound,
  end: ArraySearchBound,
  predicates: readonly [ArrayPredicate, ...ArrayPredicate[]],
  options: ArraySearchOptions,
  withValues: boolean,
) =>
  Effect.gen(function* () {
    const bounds = yield* Effect.all([parse(Bound, start), parse(Bound, end)]);
    const conditions = yield* parse(Schema.NonEmptyArray(Predicate), predicates);
    const parsed = yield* parse(Options, options);
    return [
      ...bounds.map(String),
      ...conditions.flatMap((predicate) => [predicate.type, predicate.value]),
      ...(parsed.combine === undefined ? [] : [parsed.combine]),
      ...(parsed.limit === undefined ? [] : ["LIMIT", String(parsed.limit)]),
      ...(parsed.noCase ? ["NOCASE"] : []),
      ...(withValues ? ["WITHVALUES"] : []),
    ];
  });

export const argrep = (
  key: RedisArgument,
  start: ArraySearchBound,
  end: ArraySearchBound,
  predicates: readonly [ArrayPredicate, ...ArrayPredicate[]],
  options: ArraySearchOptions = {},
) => keyed(catalog.ARGREP, key, grep(start, end, predicates, options, false), array(unsigned));

export const argrepWithValues = (
  key: RedisArgument,
  start: ArraySearchBound,
  end: ArraySearchBound,
  predicates: readonly [ArrayPredicate, ...ArrayPredicate[]],
  options: ArraySearchOptions = {},
) =>
  keyed(
    catalog.ARGREP,
    key,
    grep(start, end, predicates, options, true),
    array(tuple(unsigned, blob)),
  );
