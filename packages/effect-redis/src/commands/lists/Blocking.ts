import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { nullable, tuple } from "#/command/reply/Data";
import { blob, optional } from "#/command/reply/Scalars";
import { blocking } from "#/commands/blocking/Build";
import { catalog } from "#/commands/blocking/Catalog";
import type { BlockingOptions } from "#/commands/blocking/Timing";
import { keyIndexes } from "#/commands/internal/Command";
import { Arguments, parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { ListEnd, ListMoveOptions } from "#/commands/lists/Movement";
import type { RedisArgument } from "#/RedisArgument";

const End = Schema.Literals(["LEFT", "RIGHT"]);
type Keys = readonly [RedisArgument, ...RedisArgument[]];

const pop = (name: "BLPOP" | "BRPOP", keys: Keys, options: BlockingOptions) =>
  blocking(catalog[name], nullable(tuple(blob, blob)), options, (timeout) =>
    parse(Arguments, keys).pipe(
      Effect.map((values) => ({
        tokens: [name, ...values, timeout],
        routing: keyIndexes(
          values.map((_, index) => index + 1),
          "read-write",
        ),
      })),
    ),
  );

export const blpop = (keys: Keys, options: BlockingOptions) => pop("BLPOP", keys, options);

export const brpop = (keys: Keys, options: BlockingOptions) => pop("BRPOP", keys, options);

export const brpoplpush = (
  source: RedisArgument,
  destination: RedisArgument,
  options: BlockingOptions,
) =>
  blocking(catalog.BRPOPLPUSH, optional(blob), options, (timeout) =>
    Effect.succeed({
      tokens: ["BRPOPLPUSH", source, destination, timeout],
      routing: keyIndexes([1, 2], "read-write"),
    }),
  );

export const blmove = (
  source: RedisArgument,
  destination: RedisArgument,
  from: ListEnd,
  to: ListEnd,
  options: BlockingOptions,
) =>
  blocking(catalog.BLMOVE, optional(blob), options, (timeout) =>
    Effect.gen(function* () {
      const ends = yield* Effect.all([parse(End, from), parse(End, to)]);
      return {
        tokens: ["BLMOVE", source, destination, ...ends, timeout],
        routing: keyIndexes([1, 2], "read-write"),
      };
    }),
  );

export const blmpop = (keys: Keys, end: ListEnd, options: BlockingOptions, count: Integer = 1) =>
  blocking(catalog.BLMPOP, nullable(tuple(blob, array(blob))), options, (timeout) =>
    Effect.gen(function* () {
      const values = yield* parse(Arguments, keys);
      const side = yield* parse(End, end);
      const amount = yield* parse(Positive, count);
      return {
        tokens: [
          "BLMPOP",
          timeout,
          String(values.length),
          ...values,
          side,
          "COUNT",
          String(amount),
        ],
        routing: keyIndexes(
          values.map((_, index) => index + 3),
          "read-write",
        ),
      };
    }),
  );

export const blmovem = (
  source: RedisArgument,
  destination: RedisArgument,
  from: ListEnd,
  to: ListEnd,
  options: BlockingOptions,
  selection?: ListMoveOptions,
) =>
  blocking(catalog.BLMOVEM, nullable(array(blob)), options, (timeout) =>
    Effect.gen(function* () {
      const ends = yield* Effect.all([parse(End, from), parse(End, to)]);
      const selected =
        selection === undefined
          ? undefined
          : yield* parse(
              Schema.Struct({
                selection: Schema.Literals(["COUNT", "EXACTLY"]),
                count: Positive,
                ordering: Schema.Literals(["OBO", "BULK"]),
              }),
              selection,
            );

      return {
        tokens: [
          "BLMOVEM",
          source,
          destination,
          ...ends,
          timeout,
          ...(selected === undefined
            ? []
            : [selected.selection, String(selected.count), selected.ordering]),
        ],
        routing: keyIndexes([1, 2], "read-write"),
      };
    }),
  );
