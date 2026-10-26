import { Effect, Schema } from "effect";

import { fromPreparation } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { tuple, unsigned } from "#/command/reply/Data";
import { blob, mismatch } from "#/command/reply/Scalars";
import { index } from "#/commands/arrays/internal/Index";
import type { ArrayIndex } from "#/commands/arrays/internal/Index";
import { keyed } from "#/commands/internal/Command";
import { parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { metadata } from "#/commands/Metadata";
import type { RedisArgument } from "#/RedisArgument";

export interface ArrayScanOptions {
  readonly limit?: Integer;
}

/** ARSCAN returns ordered index/value pairs; it does not return a hash-table cursor. */
export const arscan = (
  key: RedisArgument,
  start: ArrayIndex,
  end: ArrayIndex,
  options: ArrayScanOptions = {},
) =>
  fromPreparation(
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({ limit: Schema.optionalKey(Positive) }),
        options,
      );
      const first = yield* index(start);
      const last = yield* index(end);
      const lower = BigInt(first);
      const upper = BigInt(last);
      // UINT64_MAX is the insertion-cursor sentinel, not a readable index.
      if (lower === 18446744073709551615n || upper === 18446744073709551615n)
        return yield* parse(Schema.Never, start);
      const reverse = lower > upper;
      const tail = [
        first,
        last,
        ...(selected.limit === undefined ? [] : ["LIMIT", String(selected.limit)]),
      ];
      return yield* keyed(
        metadata("ARSCAN", "arrays", ["SCAN"], ["Redis since 8.8.0"]),
        key,
        Effect.succeed(tail),
        (reply) =>
          array(tuple(unsigned, blob))(reply).pipe(
            Effect.flatMap((entries) => {
              let previous = lower;
              for (const [offset, [position]] of entries.entries()) {
                if (
                  (reverse
                    ? position > lower || position < upper
                    : position < lower || position > upper) ||
                  (offset > 0 && (reverse ? position >= previous : position <= previous))
                )
                  return Effect.fail(mismatch("custom", reply));
                previous = position;
              }
              return selected.limit !== undefined && BigInt(entries.length) > BigInt(selected.limit)
                ? Effect.fail(mismatch("array-length", reply))
                : Effect.succeed(entries);
            }),
          ),
      ).prepare;
    }),
  );
