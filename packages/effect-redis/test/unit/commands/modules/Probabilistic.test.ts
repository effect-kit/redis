import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { decodeReply } from "#/command/Decode";
import { moduleDouble } from "#/commands/modules/Reply";
import { Commands } from "#/index";

it.effect(
  "module flags decode both protocol contracts and preserve per-element full evidence",
  () =>
    Effect.gen(function* () {
      const flag = yield* Commands.bfExists("b", "value").prepare;
      expect(yield* decodeReply(flag, { _tag: "Integer", value: 1n })).toBe(true);
      expect(yield* decodeReply(flag, { _tag: "Boolean", value: false })).toBe(false);
      expect((yield* Effect.flip(decodeReply(flag, { _tag: "Integer", value: 2n })))._tag).toBe(
        "ReplyError",
      );

      const insert = yield* Commands.cfInsertnx("c", ["one", "two"]).prepare;
      expect(
        yield* decodeReply(insert, {
          _tag: "Array",
          values: [
            { _tag: "Integer", value: -1n },
            { _tag: "Boolean", value: true },
          ],
        }),
      ).toEqual([-1, 1]);
      expect((yield* Effect.flip(decodeReply(insert, { _tag: "Array", values: [] })))._tag).toBe(
        "ReplyError",
      );
    }),
);

it.effect("prepared insertion cardinality is independent of later caller mutations", () =>
  Effect.gen(function* () {
    const values: [string, ...string[]] = ["one", "two"];
    const prepared = yield* Commands.bfInsert("b", values, { noCreate: true }).prepare;
    values.pop();

    expect(prepared.tokens).toEqual(["BF.INSERT", "b", "NOCREATE", "ITEMS", "one", "two"]);
    expect(
      yield* decodeReply(prepared, {
        _tag: "Array",
        values: [
          { _tag: "Integer", value: 1n },
          { _tag: "Integer", value: 0n },
        ],
      }),
    ).toEqual([true, false]);
  }),
);

it.effect("merge routing accounts for destination, every source and signed weights", () =>
  Effect.gen(function* () {
    const prepared = yield* Commands.cmsMerge("out", ["left", "right"], { weights: [2, -1] })
      .prepare;
    expect(prepared.tokens).toEqual([
      "CMS.MERGE",
      "out",
      "2",
      "left",
      "right",
      "WEIGHTS",
      "2",
      "-1",
    ]);
    expect(prepared.routing).toEqual({
      _tag: "Keys",
      keys: [
        { index: 1, access: "write" },
        { index: 3, access: "read" },
        { index: 4, access: "read" },
      ],
    });
    expect(
      (yield* Effect.flip(Commands.cmsMerge("out", ["left"], { weights: [1, 2] }).prepare))._tag,
    ).toBe("CommandInputError");
  }),
);

it.effect(
  "statistical NaN/infinity sentinels differ from malformed or imprecise numeric replies",
  () =>
    Effect.gen(function* () {
      expect(yield* moduleDouble({ _tag: "Double", value: "nan" })).toBeNaN();
      expect(
        yield* moduleDouble({ _tag: "BlobString", value: new TextEncoder().encode("-inf") }),
      ).toBe(-Infinity);
      expect(
        (yield* Effect.flip(moduleDouble({ _tag: "Integer", value: 9007199254740993n })))._tag,
      ).toBe("ReplyError");
    }),
);

it.effect("exclusive scaling choices and invalid probabilities fail during preparation", () =>
  Effect.gen(function* () {
    for (const command of [
      Commands.bfReserve("b", 1, 100),
      Commands.bfReserve("b", 0.01, 100, { expansion: 2, nonScaling: true }),
      Commands.topkReserve("t", 1, { width: 10, depth: 5, decay: 0 }),
      Commands.tdigestTrimmedMean("t", 0.9, 0.1),
    ])
      expect((yield* Effect.flip(command.prepare))._tag).toBe("CommandInputError");

    expect(
      (yield* Commands.topkReserve("t", 1, { width: 10, depth: 5, decay: 1 }).prepare).tokens,
    ).toEqual(["TOPK.RESERVE", "t", "1", "10", "5", "1"]);
    expect((yield* Commands.cfReserve("c", 100, { expansion: 0 }).prepare).tokens).toEqual([
      "CF.RESERVE",
      "c",
      "100",
      "EXPANSION",
      "0",
    ]);
  }),
);
