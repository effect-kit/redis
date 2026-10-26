import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { ordinary, keyIndexes } from "#/commands/internal/Command";
import { Argument, parse } from "#/commands/internal/Input";
import { moduleMetadata } from "#/commands/modules/Build";
import {
  Aggregator,
  Aggregation,
  rangeArguments,
  aggregationTokens,
} from "#/commands/timeseries/Options";
import type {
  TimeSeriesAggregator,
  TimeSeriesAggregation,
  TimeSeriesBoundary,
  TimeSeriesRangeOptions,
} from "#/commands/timeseries/Options";
import { row } from "#/commands/timeseries/Reply";
import type { RedisArgument } from "#/RedisArgument";

export interface TimeSeriesPivotKey {
  readonly key: RedisArgument;
  readonly aggregators: readonly [TimeSeriesAggregator, ...TimeSeriesAggregator[]];
}
export interface TimeSeriesPivotOptions extends Omit<TimeSeriesRangeOptions, "aggregation"> {
  readonly aggregation: Omit<TimeSeriesAggregation, "aggregator">;
}
const pivot = (
  name: string,
  keys: readonly [TimeSeriesPivotKey, ...TimeSeriesPivotKey[]],
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesPivotOptions,
) =>
  ordinary(
    moduleMetadata("timeseries", name),
    array(row),
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.NonEmptyArray(
          Schema.Struct({ key: Argument, aggregators: Schema.NonEmptyArray(Aggregator) }),
        ),
        keys,
      );
      const { aggregation, ...range } = options;
      const bucket = yield* parse(
        Schema.Struct({
          bucketMillis: Aggregation.fields.bucketMillis,
          align: Aggregation.fields.align,
          bucketTimestamp: Aggregation.fields.bucketTimestamp,
          empty: Aggregation.fields.empty,
        }),
        aggregation,
      );
      const args = yield* rangeArguments(from, to, range);

      return {
        tokens: [
          name,
          String(selected.length),
          ...selected.map((entry) => entry.key),
          ...args,
          ...aggregationTokens(
            { ...bucket, aggregator: "avg" },
            selected.map((entry) => entry.aggregators.join(",")),
          ),
        ],
        routing: keyIndexes(
          selected.map((_, index) => index + 2),
          "read",
        ),
      };
    }),
  );
export const tsNrangeWithAggregations = (
  keys: readonly [TimeSeriesPivotKey, ...TimeSeriesPivotKey[]],
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesPivotOptions,
) => pivot("TS.NRANGE", keys, from, to, options);
export const tsNrevrangeWithAggregations = (
  keys: readonly [TimeSeriesPivotKey, ...TimeSeriesPivotKey[]],
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesPivotOptions,
) => pivot("TS.NREVRANGE", keys, from, to, options);
