import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { decodeReply } from "#/command/Decode";
import { Commands, encodeFloat32 } from "#/index";
import type { RespValue } from "#/index";

const blob = (value: string): RespValue => ({
  _tag: "BlobString",
  value: new TextEncoder().encode(value),
});
const double = (value: string): RespValue => ({ _tag: "Double", value });

it.effect("FP32 encoding selects byte order and rejects non-finite rounded coordinates", () =>
  Effect.gen(function* () {
    expect(yield* encodeFloat32([1, -2])).toEqual(new Uint8Array([0, 0, 128, 63, 0, 0, 0, 192]));
    expect(yield* encodeFloat32([1], "big")).toEqual(new Uint8Array([63, 128, 0, 0]));
    expect((yield* Effect.flip(encodeFloat32([Number.MAX_VALUE])))._tag).toBe("CommandInputError");
    expect(
      (yield* Effect.flip(
        Commands.vadd("v", { _tag: "FP32", bytes: new Uint8Array(3) }, "e").prepare,
      ))._tag,
    ).toBe("CommandInputError");
  }),
);

it.effect("combined vector matches normalize flat RESP2 triples and nested RESP3 maps", () =>
  Effect.gen(function* () {
    const command = yield* Commands.vsimWithScoresAndAttributes("v", {
      _tag: "Element",
      element: "one",
    }).prepare;
    const expected = [
      { element: new TextEncoder().encode("one"), score: 1, attributes: Option.none() },
    ];
    expect(
      yield* decodeReply(command, {
        _tag: "Array",
        values: [blob("one"), blob("1"), { _tag: "Null", kind: "bulk" }],
      }),
    ).toEqual(expected);
    expect(
      yield* decodeReply(command, {
        _tag: "Map",
        entries: [
          [blob("one"), { _tag: "Array", values: [double("1"), { _tag: "Null", kind: "resp3" }] }],
        ],
      }),
    ).toEqual(expected);
    expect(
      (yield* Effect.flip(decodeReply(command, { _tag: "Array", values: [blob("orphan")] })))._tag,
    ).toBe("ReplyError");
  }),
);

it.effect("raw embeddings preserve quantized bytes and optional Q8 scale", () =>
  Effect.gen(function* () {
    const command = yield* Commands.vembRaw("v", "one").prepare;
    expect(
      yield* decodeReply(command, {
        _tag: "Array",
        values: [blob("Q8"), blob("binary"), double("2"), double("0.5")],
      }),
    ).toEqual(
      Option.some({
        quantization: "Q8",
        bytes: new TextEncoder().encode("binary"),
        norm: 2,
        quantizationRange: 0.5,
      }),
    );
    expect(
      (yield* Effect.flip(
        decodeReply(command, { _tag: "Array", values: [blob("Q8"), double("2")] }),
      ))._tag,
    ).toBe("ReplyError");
  }),
);

it.effect(
  "vector preparation snapshots count and options independently of later caller changes",
  () =>
    Effect.gen(function* () {
      const coordinates: [number, ...number[]] = [1, 0];
      const options = { quantization: "NOQUANT" as const, ef: 5 };
      const command = yield* Commands.vadd("v", { _tag: "Values", coordinates }, "one", options)
        .prepare;
      coordinates.push(2);
      options.ef = 8;
      expect(command.tokens).toEqual([
        "VADD",
        "v",
        "VALUES",
        "2",
        "1",
        "0",
        "one",
        "NOQUANT",
        "EF",
        "5",
      ]);
      expect(command.routing).toEqual({ _tag: "Keys", keys: [{ index: 1, access: "read-write" }] });
    }),
);
