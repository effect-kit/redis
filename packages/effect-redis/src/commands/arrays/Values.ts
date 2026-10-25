import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { boolean, unsigned } from "#/command/reply/Data";
import { blob, optional } from "#/command/reply/Scalars";
import { catalog } from "#/commands/arrays/Catalog";
import { ArrayIndex, index } from "#/commands/arrays/internal/Index";
import { keyed } from "#/commands/internal/Command";
import { Argument, Arguments, integer as inputInteger, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { keyedVector } from "#/commands/internal/Vector";
import type { RedisArgument } from "#/RedisArgument";

export type { ArrayIndex } from "#/commands/arrays/internal/Index";
export type ArrayValues = readonly [RedisArgument, ...RedisArgument[]];

export const arcount = (key: RedisArgument) =>
  keyed(catalog.ARCOUNT, key, Effect.succeed([]), unsigned);

export const arlen = (key: RedisArgument) =>
  keyed(catalog.ARLEN, key, Effect.succeed([]), unsigned);

export const arget = (key: RedisArgument, position: ArrayIndex) =>
  keyed(catalog.ARGET, key, index(position).pipe(Effect.map((n) => [n])), optional(blob));

export const argetrange = (key: RedisArgument, start: ArrayIndex, end: ArrayIndex) =>
  keyed(catalog.ARGETRANGE, key, Effect.all([index(start), index(end)]), array(optional(blob)));

export const armget = (key: RedisArgument, positions: readonly [ArrayIndex, ...ArrayIndex[]]) =>
  keyedVector(
    catalog.ARMGET,
    key,
    parse(Schema.NonEmptyArray(ArrayIndex), positions).pipe(
      Effect.map((values) => values.map(String)),
    ),
    array(optional(blob)),
  );

export const arset = (key: RedisArgument, start: ArrayIndex, values: ArrayValues) =>
  keyed(
    catalog.ARSET,
    key,
    Effect.gen(function* () {
      return [yield* index(start), ...(yield* parse(Arguments, values))];
    }),
    unsigned,
    "read-write",
  );

export const armset = (
  key: RedisArgument,
  entries: readonly [
    readonly [ArrayIndex, RedisArgument],
    ...Array<readonly [ArrayIndex, RedisArgument]>,
  ],
) =>
  keyed(
    catalog.ARMSET,
    key,
    parse(Schema.NonEmptyArray(Schema.Tuple([ArrayIndex, Argument])), entries).pipe(
      Effect.map((values) => values.flatMap(([position, value]) => [String(position), value])),
    ),
    unsigned,
    "read-write",
  );

export const ardel = (key: RedisArgument, positions: readonly [ArrayIndex, ...ArrayIndex[]]) =>
  keyed(
    catalog.ARDEL,
    key,
    parse(Schema.NonEmptyArray(ArrayIndex), positions).pipe(
      Effect.map((values) => values.map(String)),
    ),
    unsigned,
    "read-write",
  );

export const ardelrange = (
  key: RedisArgument,
  ranges: readonly [readonly [ArrayIndex, ArrayIndex], ...Array<readonly [ArrayIndex, ArrayIndex]>],
) =>
  keyed(
    catalog.ARDELRANGE,
    key,
    parse(Schema.NonEmptyArray(Schema.Tuple([ArrayIndex, ArrayIndex])), ranges).pipe(
      Effect.map((values) => values.flat().map(String)),
    ),
    unsigned,
    "read-write",
  );

export const arinsert = (key: RedisArgument, values: ArrayValues) =>
  keyed(catalog.ARINSERT, key, parse(Arguments, values), unsigned, "read-write");

export const arnext = (key: RedisArgument) =>
  keyed(catalog.ARNEXT, key, Effect.succeed([]), optional(unsigned));

export const arseek = (key: RedisArgument, position: ArrayIndex) =>
  keyed(catalog.ARSEEK, key, index(position).pipe(Effect.map((n) => [n])), boolean, "read-write");

export const arring = (key: RedisArgument, size: ArrayIndex, values: ArrayValues) =>
  keyed(
    catalog.ARRING,
    key,
    Effect.gen(function* () {
      return [
        String(yield* parse(ArrayIndex.check(Schema.makeFilter((n) => n > 0)), size)),
        ...(yield* parse(Arguments, values)),
      ];
    }),
    unsigned,
    "read-write",
  );

export const arlastitems = (key: RedisArgument, count: Integer, reverse = false) =>
  keyed(
    catalog.ARLASTITEMS,
    key,
    Effect.gen(function* () {
      return [
        yield* inputInteger(count),
        ...((yield* parse(Schema.Boolean, reverse)) ? ["REV"] : []),
      ];
    }),
    array(optional(blob)),
  );
