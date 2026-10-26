import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { nullable, tuple } from "#/command/reply/Data";
import { blob, optional } from "#/command/reply/Scalars";
import { keyIndexes, ordinary } from "#/commands/internal/Command";
import { Arguments, parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/lists/Catalog";
import type { RedisArgument } from "#/RedisArgument";

export type ListEnd = "LEFT" | "RIGHT";
const End = Schema.Literals(["LEFT", "RIGHT"]);

export const lmove = (
  source: RedisArgument,
  destination: RedisArgument,
  from: ListEnd,
  to: ListEnd,
) =>
  ordinary(
    catalog.LMOVE,
    optional(blob),
    Effect.gen(function* () {
      const ends = yield* Effect.all([parse(End, from), parse(End, to)]);
      return {
        tokens: ["LMOVE", source, destination, ...ends],
        routing: keyIndexes([1, 2], "read-write"),
      };
    }),
  );

export const rpoplpush = (source: RedisArgument, destination: RedisArgument) =>
  ordinary(
    catalog.RPOPLPUSH,
    optional(blob),
    Effect.succeed({
      tokens: ["RPOPLPUSH", source, destination],
      routing: keyIndexes([1, 2], "read-write"),
    }),
  );

const MoveOptions = Schema.Struct({
  selection: Schema.Literals(["COUNT", "EXACTLY"]),
  count: Positive,
  ordering: Schema.Literals(["OBO", "BULK"]),
});
export type ListMoveOptions = typeof MoveOptions.Type;

export const lmovem = (
  source: RedisArgument,
  destination: RedisArgument,
  from: ListEnd,
  to: ListEnd,
  options?: ListMoveOptions,
) =>
  ordinary(
    catalog.LMOVEM,
    nullable(array(blob)),
    Effect.gen(function* () {
      const ends = yield* Effect.all([parse(End, from), parse(End, to)]);
      const selected =
        options === undefined
          ? []
          : yield* parse(MoveOptions, options).pipe(
              Effect.map((o) => [o.selection, String(o.count), o.ordering]),
            );
      return {
        tokens: ["LMOVEM", source, destination, ...ends, ...selected],
        routing: keyIndexes([1, 2], "read-write"),
      };
    }),
  );

export const lmpop = (
  keys: readonly [RedisArgument, ...RedisArgument[]],
  end: ListEnd,
  count?: Integer,
) =>
  ordinary(
    catalog.LMPOP,
    nullable(tuple(blob, array(blob))),
    Effect.gen(function* () {
      const values = yield* parse(Arguments, keys);
      const side = yield* parse(End, end);
      const limit = count === undefined ? [] : ["COUNT", String(yield* parse(Positive, count))];
      return {
        tokens: ["LMPOP", String(values.length), ...values, side, ...limit],
        routing: keyIndexes(
          values.map((_, index) => index + 2),
          "read-write",
        ),
      };
    }),
  );
