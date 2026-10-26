import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { fields } from "#/commands/admin/Build";
import { ordinary, keyIndexes } from "#/commands/internal/Command";
import { Arguments, parse } from "#/commands/internal/Input";
import { moduleKeyed, moduleMetadata } from "#/commands/modules/Build";
import { multiAggregationArguments, rangeArguments } from "#/commands/timeseries/Options";
import type {
  TimeSeriesMultiAggregationOptions,
  TimeSeriesBoundary,
  TimeSeriesRangeOptions,
} from "#/commands/timeseries/Options";
import { optionalSample, rowWithWidth, sample } from "#/commands/timeseries/Reply";
import type { RedisArgument } from "#/RedisArgument";

export const tsGet = (key: RedisArgument, options: { readonly latest?: boolean } = {}) =>
  moduleKeyed(
    "timeseries",
    "TS.GET",
    key,
    optionalSample,
    parse(Schema.Struct({ latest: Schema.optionalKey(Schema.Boolean) }), options).pipe(
      Effect.map((selected) => (selected.latest ? ["LATEST"] : [])),
    ),
  );

export const tsInfo = (key: RedisArgument, options: { readonly debug?: boolean } = {}) =>
  moduleKeyed(
    "timeseries",
    "TS.INFO",
    key,
    fields,
    parse(Schema.Struct({ debug: Schema.optionalKey(Schema.Boolean) }), options).pipe(
      Effect.map((selected) => (selected.debug ? ["DEBUG"] : [])),
    ),
  );

export const tsRange = (
  key: RedisArgument,
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesRangeOptions = {},
) => moduleKeyed("timeseries", "TS.RANGE", key, array(sample), rangeArguments(from, to, options));

export const tsRevrange = (
  key: RedisArgument,
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesRangeOptions = {},
) =>
  moduleKeyed("timeseries", "TS.REVRANGE", key, array(sample), rangeArguments(from, to, options));

const nrange = (
  name: string,
  keys: readonly [RedisArgument, ...RedisArgument[]],
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesRangeOptions,
) => ({
  prepare: Effect.gen(function* () {
    const selected = yield* parse(Arguments, keys);
    const args = yield* rangeArguments(from, to, options);
    // NRANGE has one aggregator token per key, even when every key selects the same aggregation.
    const aggIndex = args.indexOf("AGGREGATION");
    const aggregator = args[aggIndex + 1];
    const tail =
      aggIndex < 0 || aggregator === undefined
        ? args
        : [
            ...args.slice(0, aggIndex + 1),
            ...selected.map(() => aggregator),
            ...args.slice(aggIndex + 2),
          ];

    return yield* ordinary(
      moduleMetadata("timeseries", name),
      array(rowWithWidth(selected.length)),
      Effect.succeed({
        tokens: [name, String(selected.length), ...selected, ...tail],
        routing: keyIndexes(
          selected.map((_, index) => index + 2),
          "read",
        ),
      }),
    ).prepare;
  }),
});

export const tsNrange = (
  keys: readonly [RedisArgument, ...RedisArgument[]],
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesRangeOptions = {},
) => nrange("TS.NRANGE", keys, from, to, options);
export const tsNrevrange = (
  keys: readonly [RedisArgument, ...RedisArgument[]],
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesRangeOptions = {},
) => nrange("TS.NREVRANGE", keys, from, to, options);

const aggregatedRange = (
  name: string,
  key: RedisArgument,
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesMultiAggregationOptions,
) => ({
  prepare: Effect.gen(function* () {
    const { width, tokens } = yield* multiAggregationArguments(from, to, options);
    return yield* moduleKeyed(
      "timeseries",
      name,
      key,
      array(rowWithWidth(width)),
      Effect.succeed(tokens),
    ).prepare;
  }),
});

export const tsRangeWithAggregations = (
  key: RedisArgument,
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesMultiAggregationOptions,
) => aggregatedRange("TS.RANGE", key, from, to, options);

export const tsRevrangeWithAggregations = (
  key: RedisArgument,
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesMultiAggregationOptions,
) => aggregatedRange("TS.REVRANGE", key, from, to, options);
