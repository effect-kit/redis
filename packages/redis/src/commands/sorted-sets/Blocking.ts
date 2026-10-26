import { Effect, Schema } from "effect";

import { nullable, pairs, tuple, triple } from "#/command/reply/Data";
import { blob } from "#/command/reply/Scalars";
import { scoreToken } from "#/command/reply/Score";
import { blocking } from "#/commands/blocking/Build";
import { catalog } from "#/commands/blocking/Catalog";
import type { BlockingOptions } from "#/commands/blocking/Timing";
import { keyIndexes } from "#/commands/internal/Command";
import { Arguments, parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

type Keys = readonly [RedisArgument, ...RedisArgument[]];

const pop = (name: "BZPOPMIN" | "BZPOPMAX", keys: Keys, options: BlockingOptions) =>
  blocking(catalog[name], nullable(triple(blob, blob, scoreToken)), options, (timeout) =>
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

export const bzpopmin = (keys: Keys, options: BlockingOptions) => pop("BZPOPMIN", keys, options);

export const bzpopmax = (keys: Keys, options: BlockingOptions) => pop("BZPOPMAX", keys, options);

export const bzmpop = (
  keys: Keys,
  where: "MIN" | "MAX",
  options: BlockingOptions,
  count: Integer = 1,
) =>
  blocking(catalog.BZMPOP, nullable(tuple(blob, pairs(blob, scoreToken))), options, (timeout) =>
    Effect.gen(function* () {
      const values = yield* parse(Arguments, keys);
      const side = yield* parse(Schema.Literals(["MIN", "MAX"]), where);
      const amount = yield* parse(Positive, count);
      return {
        tokens: [
          "BZMPOP",
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
