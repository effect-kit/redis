import { Effect, Schema } from "effect";

import { status } from "#/command/reply/Scalars";
import { ordinary } from "#/commands/internal/Command";
import { Arguments, Integer, parse } from "#/commands/internal/Input";
import { moduleMetadata } from "#/commands/modules/Build";
import type { RedisArgument } from "#/RedisArgument";

export const cmsMerge = (
  destination: RedisArgument,
  sources: readonly [RedisArgument, ...RedisArgument[]],
  options: { readonly weights?: ReadonlyArray<Integer> } = {},
) =>
  ordinary(
    moduleMetadata("probabilistic", "CMS.MERGE"),
    status("OK"),
    Effect.gen(function* () {
      const keys = yield* parse(Arguments, sources);
      const selected = yield* parse(
        Schema.Struct({ weights: Schema.optionalKey(Schema.NonEmptyArray(Integer)) }),
        options,
      );
      if (selected.weights !== undefined && selected.weights.length !== keys.length)
        return yield* parse(Schema.Never, selected.weights);

      return {
        tokens: [
          "CMS.MERGE",
          destination,
          String(keys.length),
          ...keys,
          ...(selected.weights === undefined ? [] : ["WEIGHTS", ...selected.weights.map(String)]),
        ],
        routing: {
          _tag: "Keys",
          keys: [
            { index: 1, access: "write" },
            ...keys.map((_, index) => ({ index: index + 3, access: "read" as const })),
          ],
        },
      };
    }),
  );
