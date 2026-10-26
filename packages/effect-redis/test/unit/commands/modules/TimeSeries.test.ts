import { expect, it } from "@effect/vitest";
import { Duration, Effect, Option } from "effect";

import { decodeReply } from "#/command/Decode";
import { checkOrdinary } from "#/connection/OrdinaryCommand";
import { Commands } from "#/index";
import type { RespValue } from "#/index";
import { isBlocking } from "#/sessions/controls/Guard";

const blob = (value: string): RespValue => ({
  _tag: "BlobString",
  value: new TextEncoder().encode(value),
});
const timestamp: RespValue = { _tag: "Integer", value: 9007199254740993n };

it.effect(
  "TimeSeries samples retain exact timestamps and RESP2 simple-string numeric sentinels",
  () =>
    Effect.gen(function* () {
      const command = yield* Commands.tsGet("ts").prepare;
      expect(yield* decodeReply(command, { _tag: "Array", values: [] })).toEqual(Option.none());
      expect(
        yield* decodeReply(command, {
          _tag: "Array",
          values: [timestamp, { _tag: "SimpleString", value: new TextEncoder().encode("1.25") }],
        }),
      ).toEqual(Option.some({ timestamp: 9007199254740993n, value: 1.25 }));
      const range = yield* Commands.tsRange("ts", "-", "+").prepare;
      expect(
        yield* decodeReply(range, {
          _tag: "Array",
          values: [{ _tag: "Array", values: [timestamp, blob("nan")] }],
        }),
      ).toEqual([{ timestamp: 9007199254740993n, value: Number.NaN }]);
    }),
);

it.effect(
  "TimeSeries multi-key preparation binds cardinality, key roles and aggregation options",
  () =>
    Effect.gen(function* () {
      const entries: [
        readonly [string, number, number],
        ...Array<readonly [string, number, number]>,
      ] = [
        ["a", 1, 2],
        ["b", 2, 3],
      ];
      const command = yield* Commands.tsMadd(entries).prepare;
      entries.pop();
      expect(command.routing).toEqual({
        _tag: "Keys",
        keys: [
          { index: 1, access: "read-write" },
          { index: 4, access: "read-write" },
        ],
      });
      expect(
        (yield* Effect.flip(
          decodeReply(command, { _tag: "Array", values: [{ _tag: "Integer", value: 1n }] }),
        ))._tag,
      ).toBe("ReplyError");
      const pivot = yield* Commands.tsNrange(["a", "b"], "-", "+", {
        aggregation: { aggregator: "avg", bucketMillis: 1000 },
      }).prepare;
      expect(pivot.tokens).toEqual([
        "TS.NRANGE",
        "2",
        "a",
        "b",
        "-",
        "+",
        "AGGREGATION",
        "avg",
        "avg",
        "1000",
      ]);
      expect(pivot.routing).toEqual({
        _tag: "Keys",
        keys: [
          { index: 2, access: "read" },
          { index: 3, access: "read" },
        ],
      });
    }),
);

it.effect(
  "TimeSeries labels preserve missing selected labels and native aggregation metadata",
  () =>
    Effect.gen(function* () {
      const command = yield* Commands.tsMrange(0, 100, ["env=test"], { labels: ["absent"] })
        .prepare;
      const result = yield* decodeReply(command, {
        _tag: "Map",
        entries: [
          [
            blob("ts"),
            {
              _tag: "Array",
              values: [
                { _tag: "Map", entries: [[blob("absent"), { _tag: "Null", kind: "resp3" }]] },
                { _tag: "Map", entries: [] },
                {
                  _tag: "Array",
                  values: [{ _tag: "Array", values: [timestamp, { _tag: "Double", value: "1" }] }],
                },
              ],
            },
          ],
        ],
      });
      expect(result[0]?.labels).toEqual([[new TextEncoder().encode("absent"), Option.none()]]);
      expect(result[0]?.samples).toEqual([{ timestamp: 9007199254740993n, values: [1] }]);
      expect(result[0]?.metadata).toEqual([{ _tag: "Map", entries: [] }]);
      expect(command.routing).toEqual({ _tag: "Keyless" });
    }),
);

it.effect(
  "TS.READ blocking requests require a dedicated lane and finite positive server waits",
  () =>
    Effect.gen(function* () {
      const command = yield* Commands.tsReadBlocking("BLOCK", "$", {
        blockFor: Duration.millis(20),
        minCount: 2,
        maxCount: 3,
      }).prepare;
      expect(command.tokens).toEqual([
        "TS.READ",
        "BLOCK",
        "$",
        "BLOCK",
        "20",
        "2",
        "MAX_COUNT",
        "3",
      ]);
      expect(command.metadata.execution).toBe("blocking");
      expect(checkOrdinary(command.tokens)?.reason).toBe("session-required");
      expect(isBlocking(command.tokens)).toBe(true);
      expect(checkOrdinary(["TS.READ", "BLOCK", "0", "MAX_COUNT", "2"])).toBeUndefined();
      expect(
        (yield* Effect.flip(
          Commands.tsReadBlocking("ts", "$", { blockFor: Duration.zero }).prepare,
        ))._tag,
      ).toBe("CommandInputError");
      expect(
        (yield* Effect.flip(
          Commands.tsReadBlocking("ts", "$", {
            blockFor: Duration.seconds(1),
            minCount: 3,
            maxCount: 2,
          }).prepare,
        ))._tag,
      ).toBe("CommandInputError");
    }),
);

it.effect("TimeSeries column widths follow prepared keys and aggregation order", () =>
  Effect.gen(function* () {
    const aggregators: ["sum" | "count", ...Array<"sum" | "count">] = ["sum", "count"];
    const command = yield* Commands.tsRangeWithAggregations("ts", 0, 100, {
      aggregation: { aggregators, bucketMillis: 10 },
    }).prepare;
    aggregators.pop();
    const incomplete: RespValue = {
      _tag: "Array",
      values: [{ _tag: "Array", values: [{ _tag: "Integer", value: 1n }, blob("2")] }],
    };
    expect((yield* Effect.flip(decodeReply(command, incomplete)))._tag).toBe("ReplyError");
    const pivot = yield* Commands.tsNrange(["one", "two"], 0, 100).prepare;
    const wrongWidth: RespValue = {
      _tag: "Array",
      values: [
        {
          _tag: "Array",
          values: [
            { _tag: "Integer", value: 1n },
            { _tag: "Array", values: [blob("2")] },
          ],
        },
      ],
    };
    expect((yield* Effect.flip(decodeReply(pivot, wrongWidth)))._tag).toBe("ReplyError");
    const multiple = yield* Commands.tsMrange(0, 100, ["env=test"], {
      aggregation: { aggregators: ["sum", "count"], bucketMillis: 10 },
    }).prepare;
    const mismatch = yield* Effect.flip(
      decodeReply(multiple, {
        _tag: "Array",
        values: [
          { _tag: "Array", values: [blob("ts"), { _tag: "Array", values: [] }, incomplete] },
        ],
      }),
    );
    expect(mismatch._tag).toBe("ReplyError");
  }),
);
