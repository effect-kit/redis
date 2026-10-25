import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { nullable, pairs, tuple } from "#/command/reply/Data";
import { blob, integer } from "#/command/reply/Scalars";
import { scoreToken } from "#/command/reply/Score";
import { keyIndexes, ordinary } from "#/commands/internal/Command";
import { Arguments, NonNegative, parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/sorted-sets/Catalog";
import { Score, score } from "#/commands/sorted-sets/internal/Bounds";
import { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

export type SortedKeys = readonly [RedisArgument, ...RedisArgument[]];
const Options = Schema.Struct({
  weights: Schema.optionalKey(Schema.Array(Score)),
  aggregate: Schema.optionalKey(Schema.Literals(["SUM", "MIN", "MAX", "COUNT"])),
});
export type SortedAlgebraOptions = typeof Options.Type;

const operands = (keys: SortedKeys, options: SortedAlgebraOptions) =>
  Effect.gen(function* () {
    const values = yield* parse(Arguments, keys);
    const parsed = yield* parse(Options, options);
    const tokens: RedisArgument[] = [String(values.length), ...values];

    if (parsed.weights !== undefined) {
      if (parsed.weights.length !== values.length)
        return yield* new CommandInputError({ delivery: "unsent", reason: "options" });
      tokens.push("WEIGHTS", ...(yield* Effect.forEach(parsed.weights, score)));
    }

    if (parsed.aggregate !== undefined) tokens.push("AGGREGATE", parsed.aggregate);

    return { values, tokens };
  });

const read = (
  name: "ZINTER" | "ZUNION",
  keys: SortedKeys,
  options: SortedAlgebraOptions,
  withScores: boolean,
) =>
  operands(keys, options).pipe(
    Effect.map(({ values, tokens }) => ({
      tokens: [name, ...tokens, ...(withScores ? ["WITHSCORES"] : [])] as const,
      routing: keyIndexes(
        values.map((_, index) => index + 2),
        "read",
      ),
    })),
  );

export const zinter = (keys: SortedKeys, options: SortedAlgebraOptions = {}) =>
  ordinary(catalog.ZINTER, array(blob), read("ZINTER", keys, options, false));

export const zinterWithScores = (keys: SortedKeys, options: SortedAlgebraOptions = {}) =>
  ordinary(catalog.ZINTER, pairs(blob, scoreToken), read("ZINTER", keys, options, true));

export const zunion = (keys: SortedKeys, options: SortedAlgebraOptions = {}) =>
  ordinary(catalog.ZUNION, array(blob), read("ZUNION", keys, options, false));

export const zunionWithScores = (keys: SortedKeys, options: SortedAlgebraOptions = {}) =>
  ordinary(catalog.ZUNION, pairs(blob, scoreToken), read("ZUNION", keys, options, true));

const store = (
  name: "ZINTERSTORE" | "ZUNIONSTORE",
  destination: RedisArgument,
  keys: SortedKeys,
  options: SortedAlgebraOptions,
) =>
  ordinary(
    catalog[name],
    integer,
    operands(keys, options).pipe(
      Effect.map(({ values, tokens }) => ({
        tokens: [name, destination, ...tokens],
        routing: {
          _tag: "Keys",
          keys: [
            { index: 1, access: "write" },
            ...values.map((_, index) => ({ index: index + 3, access: "read" as const })),
          ],
        },
      })),
    ),
  );

export const zinterstore = (
  destination: RedisArgument,
  keys: SortedKeys,
  options: SortedAlgebraOptions = {},
) => store("ZINTERSTORE", destination, keys, options);

export const zunionstore = (
  destination: RedisArgument,
  keys: SortedKeys,
  options: SortedAlgebraOptions = {},
) => store("ZUNIONSTORE", destination, keys, options);

const difference = (keys: SortedKeys, withScores: boolean) =>
  parse(Arguments, keys).pipe(
    Effect.map((values) => ({
      tokens: [
        "ZDIFF",
        String(values.length),
        ...values,
        ...(withScores ? ["WITHSCORES"] : []),
      ] as const,
      routing: keyIndexes(
        values.map((_, index) => index + 2),
        "read",
      ),
    })),
  );

export const zdiff = (keys: SortedKeys) =>
  ordinary(catalog.ZDIFF, array(blob), difference(keys, false));

export const zdiffWithScores = (keys: SortedKeys) =>
  ordinary(catalog.ZDIFF, pairs(blob, scoreToken), difference(keys, true));

export const zdiffstore = (destination: RedisArgument, keys: SortedKeys) =>
  ordinary(
    catalog.ZDIFFSTORE,
    integer,
    parse(Arguments, keys).pipe(
      Effect.map((values) => ({
        tokens: ["ZDIFFSTORE", destination, String(values.length), ...values],
        routing: {
          _tag: "Keys",
          keys: [
            { index: 1, access: "write" },
            ...values.map((_, index) => ({ index: index + 3, access: "read" as const })),
          ],
        },
      })),
    ),
  );

export const zintercard = (keys: SortedKeys, limit?: Integer) =>
  ordinary(
    catalog.ZINTERCARD,
    integer,
    Effect.gen(function* () {
      const values = yield* parse(Arguments, keys);
      const tail = limit === undefined ? [] : ["LIMIT", String(yield* parse(NonNegative, limit))];
      return {
        tokens: ["ZINTERCARD", String(values.length), ...values, ...tail],
        routing: keyIndexes(
          values.map((_, index) => index + 2),
          "read",
        ),
      };
    }),
  );

export const zmpop = (keys: SortedKeys, where: "MIN" | "MAX", count: Integer = 1) =>
  ordinary(
    catalog.ZMPOP,
    nullable(tuple(blob, pairs(blob, scoreToken))),
    Effect.gen(function* () {
      const values = yield* parse(Arguments, keys);
      const mode = yield* parse(Schema.Literals(["MIN", "MAX"]), where);
      const selected = yield* parse(Positive, count);
      return {
        tokens: ["ZMPOP", String(values.length), ...values, mode, "COUNT", String(selected)],
        routing: keyIndexes(
          values.map((_, index) => index + 2),
          "read-write",
        ),
      };
    }),
  );
