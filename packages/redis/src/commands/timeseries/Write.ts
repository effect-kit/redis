import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { unsigned, withLength } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { ordinary, keyIndexes } from "#/commands/internal/Command";
import { Argument, Finite, NonNegative, Positive, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyed, moduleMetadata } from "#/commands/modules/Build";
import {
  Aggregator,
  CreateOptions,
  DuplicatePolicy,
  Timestamp,
  creationTokens,
} from "#/commands/timeseries/Options";
import type {
  TimeSeriesAggregator,
  TimeSeriesCreateOptions,
  TimeSeriesTimestamp,
} from "#/commands/timeseries/Options";
import type { RedisArgument } from "#/RedisArgument";

export const tsCreate = (key: RedisArgument, options: TimeSeriesCreateOptions = {}) =>
  moduleKeyed(
    "timeseries",
    "TS.CREATE",
    key,
    status("OK"),
    parse(CreateOptions, options).pipe(Effect.map(creationTokens)),
    "read-write",
  );

export const tsAlter = (key: RedisArgument, options: Omit<TimeSeriesCreateOptions, "encoding">) =>
  moduleKeyed(
    "timeseries",
    "TS.ALTER",
    key,
    status("OK"),
    parse(
      Schema.Struct({
        retentionMillis: CreateOptions.fields.retentionMillis,
        chunkSizeBytes: CreateOptions.fields.chunkSizeBytes,
        duplicatePolicy: CreateOptions.fields.duplicatePolicy,
        ignore: CreateOptions.fields.ignore,
        labels: CreateOptions.fields.labels,
      }),
      options,
    ).pipe(Effect.map(creationTokens)),
    "read-write",
  );

export interface TimeSeriesAddOptions extends TimeSeriesCreateOptions {
  readonly onDuplicate?: DuplicatePolicy;
}

export const tsAdd = (
  key: RedisArgument,
  timestamp: TimeSeriesTimestamp,
  value: number,
  options: TimeSeriesAddOptions = {},
) =>
  moduleKeyed(
    "timeseries",
    "TS.ADD",
    key,
    unsigned,
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({
          ...CreateOptions.fields,
          onDuplicate: Schema.optionalKey(DuplicatePolicy),
        }),
        options,
      );
      const ts = yield* parse(Timestamp, timestamp);
      const number = yield* parse(Finite, value);

      return [
        String(ts),
        String(number),
        ...creationTokens(selected),
        ...(selected.onDuplicate === undefined ? [] : ["ON_DUPLICATE", selected.onDuplicate]),
      ];
    }),
    "read-write",
  );

export const tsMadd = (
  entries: readonly [
    readonly [RedisArgument, TimeSeriesTimestamp, number],
    ...Array<readonly [RedisArgument, TimeSeriesTimestamp, number]>,
  ],
) => ({
  prepare: Effect.gen(function* () {
    const selected = yield* parse(
      Schema.NonEmptyArray(Schema.Tuple([Argument, Timestamp, Finite])),
      entries,
    );

    return yield* ordinary(
      moduleMetadata("timeseries", "TS.MADD"),
      withLength(selected.length, array(unsigned)),
      Effect.succeed({
        tokens: [
          "TS.MADD",
          ...selected.flatMap(([key, timestamp, value]) => [key, String(timestamp), String(value)]),
        ],
        routing: keyIndexes(
          selected.map((_, index) => 1 + index * 3),
          "read-write",
        ),
      }),
    ).prepare;
  }),
});

export interface TimeSeriesIncrementOptions extends TimeSeriesCreateOptions {
  readonly timestamp?: TimeSeriesTimestamp;
}
const increment = (
  name: string,
  key: RedisArgument,
  value: number,
  options: TimeSeriesIncrementOptions,
) =>
  moduleKeyed(
    "timeseries",
    name,
    key,
    unsigned,
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({ ...CreateOptions.fields, timestamp: Schema.optionalKey(Timestamp) }),
        options,
      );
      const number = yield* parse(Finite, value);
      return [
        String(number),
        ...(selected.timestamp === undefined ? [] : ["TIMESTAMP", String(selected.timestamp)]),
        ...creationTokens(selected),
      ];
    }),
    "read-write",
  );
export const tsIncrby = (
  key: RedisArgument,
  value: number,
  options: TimeSeriesIncrementOptions = {},
) => increment("TS.INCRBY", key, value, options);
export const tsDecrby = (
  key: RedisArgument,
  value: number,
  options: TimeSeriesIncrementOptions = {},
) => increment("TS.DECRBY", key, value, options);

export const tsDel = (key: RedisArgument, from: Integer, to: Integer) =>
  moduleKeyed(
    "timeseries",
    "TS.DEL",
    key,
    unsigned,
    Effect.gen(function* () {
      const start = yield* parse(NonNegative, from);
      const end = yield* parse(NonNegative, to);
      return [String(start), String(end)];
    }),
    "read-write",
  );

export const tsCreaterule = (
  source: RedisArgument,
  destination: RedisArgument,
  aggregator: TimeSeriesAggregator,
  bucketMillis: Integer,
  alignTimestamp?: Integer,
) =>
  ordinary(
    moduleMetadata("timeseries", "TS.CREATERULE"),
    status("OK"),
    Effect.gen(function* () {
      const selected = yield* parse(Aggregator, aggregator);
      const bucket = yield* parse(Positive, bucketMillis);
      const align =
        alignTimestamp === undefined ? undefined : yield* parse(NonNegative, alignTimestamp);
      return {
        tokens: [
          "TS.CREATERULE",
          source,
          destination,
          "AGGREGATION",
          selected,
          String(bucket),
          ...(align === undefined ? [] : [String(align)]),
        ],
        routing: keyIndexes([1, 2], "read-write"),
      };
    }),
  );
export const tsDeleterule = (source: RedisArgument, destination: RedisArgument) =>
  ordinary(
    moduleMetadata("timeseries", "TS.DELETERULE"),
    status("OK"),
    Effect.succeed({
      tokens: ["TS.DELETERULE", source, destination],
      routing: keyIndexes([1, 2], "read-write"),
    }),
  );
