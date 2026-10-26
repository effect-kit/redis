import { Effect, Schema } from "effect";
import type { Duration } from "effect";

import { defineCommand, fromPreparation } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { blockingTiming } from "#/commands/blocking/Timing";
import { keyIndexes } from "#/commands/internal/Command";
import { NonNegative, Positive, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyed, moduleMetadata } from "#/commands/modules/Build";
import { sample } from "#/commands/timeseries/Reply";
import type { RedisArgument } from "#/RedisArgument";

export type TimeSeriesReadCursor = Integer | "-" | "+" | "$";
const Cursor = Schema.Union([NonNegative, Schema.Literals(["-", "+", "$"])]);
const ReadOptions = Schema.Struct({ maxCount: Schema.optionalKey(Positive) });
export const tsRead = (
  key: RedisArgument,
  cursor: TimeSeriesReadCursor,
  options: { readonly maxCount?: Integer } = {},
) =>
  moduleKeyed(
    "timeseries",
    "TS.READ",
    key,
    array(sample),
    Effect.gen(function* () {
      const selected = yield* parse(ReadOptions, options);
      const timestamp = yield* parse(Cursor, cursor);
      return [
        String(timestamp),
        ...(selected.maxCount === undefined ? [] : ["MAX_COUNT", String(selected.maxCount)]),
      ];
    }),
  );

export interface TimeSeriesBlockingReadOptions {
  readonly blockFor: Duration.Duration;
  readonly timeout?: Duration.Duration | "forever";
  readonly minCount?: Integer;
  readonly maxCount?: Integer;
}
export const tsReadBlocking = (
  key: RedisArgument,
  cursor: TimeSeriesReadCursor,
  options: TimeSeriesBlockingReadOptions,
) =>
  fromPreparation(
    Effect.gen(function* () {
      // TS.READ BLOCK 0 means no wait, unlike Redis list/stream commands. A forever token would change semantics.
      const selected = yield* parse(
        Schema.Struct({
          blockFor: Schema.Duration,
          timeout: Schema.optionalKey(Schema.Union([Schema.Duration, Schema.Literal("forever")])),
          minCount: Schema.optionalKey(Positive),
          maxCount: Schema.optionalKey(Positive),
        }).check(
          Schema.makeFilter((o) => o.maxCount === undefined || (o.minCount ?? 1) <= o.maxCount),
        ),
        options,
      );
      const timing = yield* blockingTiming(
        {
          blockFor: selected.blockFor,
          ...(selected.timeout === undefined ? {} : { timeout: selected.timeout }),
        },
        "milliseconds",
      );
      const timestamp = yield* parse(Cursor, cursor);

      return yield* defineCommand({
        tokens: [
          "TS.READ",
          key,
          String(timestamp),
          "BLOCK",
          timing.token,
          String(selected.minCount ?? 1),
          ...(selected.maxCount === undefined ? [] : ["MAX_COUNT", String(selected.maxCount)]),
        ],
        routing: keyIndexes([1], "read"),
        metadata: { ...moduleMetadata("timeseries", "TS.READ"), execution: "blocking" },
        decode: array(sample),
        replyTimeoutMillis: timing.replyTimeoutMillis,
      }).prepare;
    }),
  );
