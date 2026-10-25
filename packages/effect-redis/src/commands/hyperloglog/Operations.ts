import { Effect, Schema } from "effect";

import { boolean } from "#/command/reply/Data";
import { integer, status } from "#/command/reply/Scalars";
import { catalog } from "#/commands/hyperloglog/Catalog";
import { keyed, keyIndexes, ordinary } from "#/commands/internal/Command";
import { Argument, Arguments, parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export const pfadd = (key: RedisArgument, elements: ReadonlyArray<RedisArgument> = []) =>
  keyed(catalog.PFADD, key, parse(Schema.Array(Argument), elements), boolean, "read-write");

export const pfcount = (keys: readonly [RedisArgument, ...RedisArgument[]]) =>
  ordinary(
    catalog.PFCOUNT,
    integer,
    parse(Arguments, keys).pipe(
      Effect.map((values) => ({
        tokens: ["PFCOUNT", ...values],
        routing: keyIndexes(
          values.map((_, index) => index + 1),
          "read",
        ),
      })),
    ),
  );

export const pfmerge = (
  destination: RedisArgument,
  keys: readonly [RedisArgument, ...RedisArgument[]],
) =>
  ordinary(
    catalog.PFMERGE,
    status("OK"),
    parse(Arguments, keys).pipe(
      Effect.map((values) => ({
        tokens: ["PFMERGE", destination, ...values],
        routing: {
          _tag: "Keys",
          keys: [
            { index: 1, access: "read-write" },
            ...values.map((_, index) => ({ index: index + 2, access: "read" as const })),
          ],
        },
      })),
    ),
  );
