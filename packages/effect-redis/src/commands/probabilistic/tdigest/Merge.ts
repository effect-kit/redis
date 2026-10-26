import { Effect, Schema } from "effect";

import { status } from "#/command/reply/Scalars";
import { ordinary } from "#/commands/internal/Command";
import { Arguments, parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleMetadata } from "#/commands/modules/Build";
import type { RedisArgument } from "#/RedisArgument";

export const tdigestMerge = (
  destination: RedisArgument,
  sources: readonly [RedisArgument, ...RedisArgument[]],
  options: { readonly compression?: Integer; readonly override?: boolean } = {},
) =>
  ordinary(
    moduleMetadata("probabilistic", "TDIGEST.MERGE"),
    status("OK"),
    Effect.gen(function* () {
      const keys = yield* parse(Arguments, sources);
      const selected = yield* parse(
        Schema.Struct({
          compression: Schema.optionalKey(Positive),
          override: Schema.optionalKey(Schema.Boolean),
        }),
        options,
      );
      return {
        tokens: [
          "TDIGEST.MERGE",
          destination,
          String(keys.length),
          ...keys,
          ...(selected.compression === undefined
            ? []
            : ["COMPRESSION", String(selected.compression)]),
          ...(selected.override ? ["OVERRIDE"] : []),
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
