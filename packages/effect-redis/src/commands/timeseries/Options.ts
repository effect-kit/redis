import { Effect, Schema } from "effect";

import { Argument, Finite, NonNegative, Positive, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export const DuplicatePolicy = Schema.Literals(["BLOCK", "FIRST", "LAST", "MIN", "MAX", "SUM"]);
export type DuplicatePolicy = typeof DuplicatePolicy.Type;
export type TimeSeriesTimestamp = Integer | "*";
export type TimeSeriesBoundary = Integer | "-" | "+";
export const Timestamp = Schema.Union([NonNegative, Schema.Literal("*")]);
export const Boundary = Schema.Union([NonNegative, Schema.Literals(["-", "+"])]);

export interface TimeSeriesCreateOptions {
  readonly retentionMillis?: Integer;
  readonly encoding?: "COMPRESSED" | "UNCOMPRESSED";
  readonly chunkSizeBytes?: Integer;
  readonly duplicatePolicy?: DuplicatePolicy;
  readonly ignore?: { readonly maxTimeDiffMillis: Integer; readonly maxValueDiff: number };
  readonly labels?: ReadonlyArray<readonly [RedisArgument, RedisArgument]>;
}
export const CreateOptions = Schema.Struct({
  retentionMillis: Schema.optionalKey(NonNegative),
  encoding: Schema.optionalKey(Schema.Literals(["COMPRESSED", "UNCOMPRESSED"])),
  chunkSizeBytes: Schema.optionalKey(Positive),
  duplicatePolicy: Schema.optionalKey(DuplicatePolicy),
  ignore: Schema.optionalKey(
    Schema.Struct({
      maxTimeDiffMillis: NonNegative,
      maxValueDiff: Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
  labels: Schema.optionalKey(Schema.Array(Schema.Tuple([Argument, Argument]))),
});

export const creationTokens = (selected: TimeSeriesCreateOptions): ReadonlyArray<RedisArgument> => [
  ...(selected.retentionMillis === undefined
    ? []
    : ["RETENTION", String(selected.retentionMillis)]),
  ...(selected.encoding === undefined ? [] : ["ENCODING", selected.encoding]),
  ...(selected.chunkSizeBytes === undefined ? [] : ["CHUNK_SIZE", String(selected.chunkSizeBytes)]),
  ...(selected.duplicatePolicy === undefined ? [] : ["DUPLICATE_POLICY", selected.duplicatePolicy]),
  ...(selected.ignore === undefined
    ? []
    : ["IGNORE", String(selected.ignore.maxTimeDiffMillis), String(selected.ignore.maxValueDiff)]),
  ...(selected.labels === undefined
    ? []
    : ["LABELS", ...selected.labels.flatMap(([label, value]) => [label, value])]),
];

export const Aggregator = Schema.Literals([
  "avg",
  "sum",
  "min",
  "max",
  "range",
  "count",
  "first",
  "last",
  "std.p",
  "std.s",
  "var.p",
  "var.s",
  "twa",
  "countnan",
  "countall",
]);
export type TimeSeriesAggregator = typeof Aggregator.Type;
export interface TimeSeriesAggregation {
  readonly aggregator: TimeSeriesAggregator;
  readonly bucketMillis: Integer;
  readonly align?: Integer | "-" | "+";
  readonly bucketTimestamp?: "start" | "end" | "mid" | "-" | "+" | "~";
  readonly empty?: boolean;
}
export const Aggregation = Schema.Struct({
  aggregator: Aggregator,
  bucketMillis: Positive,
  align: Schema.optionalKey(Boundary),
  bucketTimestamp: Schema.optionalKey(Schema.Literals(["start", "end", "mid", "-", "+", "~"])),
  empty: Schema.optionalKey(Schema.Boolean),
});
export interface TimeSeriesRangeOptions {
  readonly latest?: boolean;
  readonly filterByTimestamps?: readonly [Integer, ...Integer[]];
  readonly filterByValue?: readonly [number, number];
  readonly count?: Integer;
  readonly aggregation?: TimeSeriesAggregation;
}
export const RangeOptions = Schema.Struct({
  latest: Schema.optionalKey(Schema.Boolean),
  filterByTimestamps: Schema.optionalKey(Schema.NonEmptyArray(NonNegative)),
  filterByValue: Schema.optionalKey(Schema.Tuple([Finite, Finite])),
  count: Schema.optionalKey(Positive),
  aggregation: Schema.optionalKey(Aggregation),
});

export const aggregationTokens = (
  selected: TimeSeriesAggregation,
  aggregators: ReadonlyArray<string> = [selected.aggregator],
): ReadonlyArray<RedisArgument> => [
  ...(selected.align === undefined ? [] : ["ALIGN", String(selected.align)]),
  "AGGREGATION",
  ...aggregators,
  String(selected.bucketMillis),
  ...(selected.bucketTimestamp === undefined ? [] : ["BUCKETTIMESTAMP", selected.bucketTimestamp]),
  ...(selected.empty ? ["EMPTY"] : []),
];
export const rangeTokens = (selected: TimeSeriesRangeOptions): ReadonlyArray<RedisArgument> => [
  ...(selected.latest ? ["LATEST"] : []),
  ...(selected.filterByTimestamps === undefined
    ? []
    : ["FILTER_BY_TS", ...selected.filterByTimestamps.map(String)]),
  ...(selected.filterByValue === undefined
    ? []
    : ["FILTER_BY_VALUE", ...selected.filterByValue.map(String)]),
  ...(selected.count === undefined ? [] : ["COUNT", String(selected.count)]),
  ...(selected.aggregation === undefined ? [] : aggregationTokens(selected.aggregation)),
];

export const rangeArguments = Effect.fnUntraced(function* (
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesRangeOptions,
) {
  const start = yield* parse(Boundary, from);
  const end = yield* parse(Boundary, to);
  const selected = yield* parse(RangeOptions, options);

  return [String(start), String(end), ...rangeTokens(selected)];
});

export interface TimeSeriesMultiAggregation extends Omit<TimeSeriesAggregation, "aggregator"> {
  readonly aggregators: readonly [TimeSeriesAggregator, ...TimeSeriesAggregator[]];
}
export interface TimeSeriesMultiAggregationOptions extends Omit<
  TimeSeriesRangeOptions,
  "aggregation"
> {
  readonly aggregation: TimeSeriesMultiAggregation;
}
export const MultiAggregation = Schema.Struct({
  aggregators: Schema.NonEmptyArray(Aggregator),
  bucketMillis: Aggregation.fields.bucketMillis,
  align: Aggregation.fields.align,
  bucketTimestamp: Aggregation.fields.bucketTimestamp,
  empty: Aggregation.fields.empty,
});
export const multiAggregationArguments = Effect.fnUntraced(function* (
  from: TimeSeriesBoundary,
  to: TimeSeriesBoundary,
  options: TimeSeriesMultiAggregationOptions,
) {
  const selected = yield* parse(
    Schema.Struct({ ...RangeOptions.fields, aggregation: MultiAggregation }),
    options,
  );
  const { aggregation, ...range } = selected;
  const args = yield* rangeArguments(from, to, range);
  const [first = "avg"] = aggregation.aggregators;

  return {
    width: aggregation.aggregators.length,
    tokens: [
      ...args,
      ...aggregationTokens({ ...aggregation, aggregator: first }, [
        aggregation.aggregators.join(","),
      ]),
    ],
  };
});
