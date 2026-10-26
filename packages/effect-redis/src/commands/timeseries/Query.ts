import { Effect, Schema } from "effect";

import { members } from "#/command/reply/Data";
import { blob } from "#/command/reply/Scalars";
import { Arguments, Argument, parse } from "#/commands/internal/Input";
import { moduleKeyless } from "#/commands/modules/Build";
import {
  Aggregation,
  Aggregator,
  MultiAggregation,
  RangeOptions,
  multiAggregationArguments,
  rangeArguments,
} from "#/commands/timeseries/Options";
import type {
  TimeSeriesAggregator,
  TimeSeriesAggregation,
  TimeSeriesMultiAggregation,
  TimeSeriesBoundary,
  TimeSeriesRangeOptions,
} from "#/commands/timeseries/Options";
import { multiGet, multiRange } from "#/commands/timeseries/Reply";
import type { RedisArgument } from "#/RedisArgument";

export type TimeSeriesLabelSelection = "all" | readonly [RedisArgument, ...RedisArgument[]];
const Labels = Schema.Union([Schema.Literal("all"), Arguments]);
export interface TimeSeriesGetOptions {
  readonly latest?: boolean;
  readonly labels?: TimeSeriesLabelSelection;
}
const labelTokens = (
  selected: TimeSeriesLabelSelection | undefined,
): ReadonlyArray<RedisArgument> =>
  selected === undefined
    ? []
    : selected === "all"
      ? ["WITHLABELS"]
      : ["SELECTED_LABELS", ...selected];

export const tsQueryindex = (filters: readonly [RedisArgument, ...RedisArgument[]]) =>
  moduleKeyless("timeseries", "TS.QUERYINDEX", members(blob), parse(Arguments, filters));
export const tsQuerylabels = (filters: ReadonlyArray<RedisArgument> = []) =>
  moduleKeyless(
    "timeseries",
    "TS.QUERYLABELS",
    members(blob),
    parse(Schema.Array(Argument), filters).pipe(
      Effect.map((selected) => [
        "LABELS",
        ...(selected.length === 0 ? [] : ["FILTER", ...selected]),
      ]),
    ),
  );
export const tsQuerylabelValues = (
  label: RedisArgument,
  filters: ReadonlyArray<RedisArgument> = [],
) =>
  moduleKeyless(
    "timeseries",
    "TS.QUERYLABELS",
    members(blob),
    parse(Schema.Array(Argument), filters).pipe(
      Effect.map((selected) => [
        "VALUES",
        label,
        ...(selected.length === 0 ? [] : ["FILTER", ...selected]),
      ]),
    ),
  );
export const tsMget = (
  filters: readonly [RedisArgument, ...RedisArgument[]],
  options: TimeSeriesGetOptions = {},
) =>
  moduleKeyless(
    "timeseries",
    "TS.MGET",
    multiGet,
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({
          latest: Schema.optionalKey(Schema.Boolean),
          labels: Schema.optionalKey(Labels),
        }),
        options,
      );
      const expressions = yield* parse(Arguments, filters);
      return [
        ...(selected.latest ? ["LATEST"] : []),
        ...labelTokens(selected.labels),
        "FILTER",
        ...expressions,
      ];
    }),
  );

export interface TimeSeriesMultiRangeOptions extends Omit<TimeSeriesRangeOptions, "aggregation"> {
  readonly aggregation?: TimeSeriesAggregation | TimeSeriesMultiAggregation;
  readonly labels?: TimeSeriesLabelSelection;
  readonly groupBy?: { readonly label: RedisArgument; readonly reducer: TimeSeriesAggregator };
  readonly excludeEmpty?: boolean;
}
const query = (
  name: string,
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  filters: readonly [RedisArgument, ...RedisArgument[]],
  options: TimeSeriesMultiRangeOptions,
) =>
  moduleKeyless(
    "timeseries",
    name,
    multiRange,
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({
          ...RangeOptions.fields,
          aggregation: Schema.optionalKey(Schema.Union([Aggregation, MultiAggregation])),
          labels: Schema.optionalKey(Labels),
          groupBy: Schema.optionalKey(Schema.Struct({ label: Argument, reducer: Aggregator })),
          excludeEmpty: Schema.optionalKey(Schema.Boolean),
        }),
        options,
      );
      const {
        labels: _labels,
        groupBy: _groupBy,
        excludeEmpty: _excludeEmpty,
        aggregation,
        ...range
      } = selected;
      const args =
        aggregation !== undefined && "aggregators" in aggregation
          ? yield* multiAggregationArguments(from, to, { ...range, aggregation })
          : yield* rangeArguments(from, to, {
              ...range,
              ...(aggregation === undefined ? {} : { aggregation }),
            });
      const expressions = yield* parse(Arguments, filters);

      return [
        ...args,
        ...labelTokens(selected.labels),
        ...(selected.excludeEmpty ? ["EXCLUDEEMPTY"] : []),
        "FILTER",
        ...expressions,
        ...(selected.groupBy === undefined
          ? []
          : ["GROUPBY", selected.groupBy.label, "REDUCE", selected.groupBy.reducer]),
      ];
    }),
  );
export const tsMrange = (
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  filters: readonly [RedisArgument, ...RedisArgument[]],
  options: TimeSeriesMultiRangeOptions = {},
) => query("TS.MRANGE", from, to, filters, options);
export const tsMrevrange = (
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  filters: readonly [RedisArgument, ...RedisArgument[]],
  options: TimeSeriesMultiRangeOptions = {},
) => query("TS.MREVRANGE", from, to, filters, options);
