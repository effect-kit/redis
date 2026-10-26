import { Effect, Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { nullable, pairs, tuple, unsigned } from "#/command/reply/Data";
import { blob, mismatch, undecorate } from "#/command/reply/Scalars";
import { moduleDouble } from "#/commands/modules/Reply";
import type { RespValue } from "#/protocol/RespValue";

export interface TimeSeriesSample {
  readonly timestamp: bigint;
  readonly value: number;
}
export interface TimeSeriesRow {
  readonly timestamp: bigint;
  readonly values: ReadonlyArray<number>;
}
export const sample: ReplyDecoder<TimeSeriesSample> = (reply) =>
  tuple(
    unsigned,
    moduleDouble,
  )(reply).pipe(Effect.map(([timestamp, value]) => ({ timestamp, value })));
export const optionalSample: ReplyDecoder<Option.Option<TimeSeriesSample>> = (reply) => {
  const value = undecorate(reply);
  return value._tag === "Array" && value.values.length === 0
    ? Effect.succeed(Option.none())
    : nullable(sample)(reply);
};

/** Multi-aggregation samples are flat [timestamp, v1, ...], while NRANGE pivots values into one array. */
export const row: ReplyDecoder<TimeSeriesRow> = (reply) => {
  const value = undecorate(reply);
  if (value._tag !== "Array" || value.values.length < 2)
    return Effect.fail(mismatch("array", reply));
  const [timestamp, ...tail] = value.values;
  if (timestamp === undefined) return Effect.fail(mismatch("array", reply));
  const single = tail[0];
  const columns = tail.length === 1 && single?._tag === "Array" ? single.values : tail;

  return Effect.all([unsigned(timestamp), Effect.forEach(columns, moduleDouble)]).pipe(
    Effect.map(([decodedTimestamp, values]) => ({ timestamp: decodedTimestamp, values })),
  );
};

/** Columns belong to the prepared key/aggregation order; accepting a different width would misattribute values. */
export const rowWithWidth =
  (width: number): ReplyDecoder<TimeSeriesRow> =>
  (reply) =>
    row(reply).pipe(
      Effect.flatMap((decodedRow) =>
        decodedRow.values.length === width
          ? Effect.succeed(decodedRow)
          : Effect.fail(mismatch("array-length", reply)),
      ),
    );

export type TimeSeriesLabels = ReadonlyArray<readonly [Uint8Array, Option.Option<Uint8Array>]>;
export interface TimeSeriesResult {
  readonly key: Uint8Array;
  readonly labels: TimeSeriesLabels;
  readonly samples: ReadonlyArray<TimeSeriesRow>;
  /** RESP3 aggregation/reducer/source reports; RESP2 encodes some of these as synthetic labels. */
  readonly metadata: ReadonlyArray<RespValue>;
}
const labels = pairs(blob, nullable(blob));
export const multiRange =
  (width: number): ReplyDecoder<ReadonlyArray<TimeSeriesResult>> =>
  (reply) => {
    const value = undecorate(reply);
    const entries: Array<readonly [RespValue, ReadonlyArray<RespValue>]> = [];
    if (value._tag === "Map") {
      for (const [key, body] of value.entries) {
        if (body._tag !== "Array" || body.values.length < 2)
          return Effect.fail(mismatch("array", reply));
        entries.push([key, body.values]);
      }
    } else if (value._tag === "Array") {
      for (const entry of value.values) {
        if (entry._tag !== "Array" || entry.values.length !== 3)
          return Effect.fail(mismatch("array", reply));
        const [key, ...body] = entry.values;
        if (key === undefined) return Effect.fail(mismatch("array", reply));
        entries.push([key, body]);
      }
    } else return Effect.fail(mismatch("array", reply));

    return Effect.forEach(entries, ([key, body]) =>
      Effect.gen(function* () {
        const first = body[0];
        const last = body[body.length - 1];
        if (first === undefined || last === undefined) return yield* mismatch("array", reply);
        return {
          key: yield* blob(key),
          labels: yield* labels(first),
          samples: yield* array(rowWithWidth(width))(last),
          metadata: body.slice(1, -1),
        };
      }),
    );
  };

export interface TimeSeriesGetResult {
  readonly key: Uint8Array;
  readonly labels: TimeSeriesLabels;
  readonly sample: Option.Option<TimeSeriesSample>;
}
export const multiGet: ReplyDecoder<ReadonlyArray<TimeSeriesGetResult>> = (reply) => {
  const value = undecorate(reply);
  const normalized: RespValue =
    value._tag === "Map"
      ? {
          _tag: "Array",
          values: value.entries.map(([key, body]) => ({
            _tag: "Array",
            values: body._tag === "Array" ? [key, ...body.values] : [key, body],
          })),
        }
      : value;

  return array(getEntry)(normalized);
};

const getEntry: ReplyDecoder<TimeSeriesGetResult> = (reply) => {
  const value = undecorate(reply);
  if (value._tag !== "Array" || value.values.length !== 3)
    return Effect.fail(mismatch("array", reply));
  const [key, selectedLabels, selectedSample] = value.values;
  if (key === undefined || selectedLabels === undefined || selectedSample === undefined)
    return Effect.fail(mismatch("array", reply));
  return Effect.gen(function* () {
    return {
      key: yield* blob(key),
      labels: yield* labels(selectedLabels),
      sample: yield* optionalSample(selectedSample),
    };
  });
};
