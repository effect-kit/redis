import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Commands } from "#/index";
import { array, blob, bytes } from "#test/support/commands/CoreCase";

it.effect("DIALECT: Dragonfly uncounted ZRANDMEMBER preserves one member and absence", () =>
  Effect.gen(function* () {
    const command = yield* Commands.zrandmember("k").prepare;

    expect(yield* command.decode(array(blob("member")))).toEqual(Option.some(bytes("member")));
    expect(yield* command.decode(array())).toEqual(Option.none());
    expect(yield* Effect.flip(command.decode(array(blob("a"), blob("b"))))).toMatchObject({
      _tag: "ReplyError",
      expected: "array-length",
    });
    expect(yield* Effect.flip(command.decode(array({ _tag: "Integer", value: 1n })))).toMatchObject(
      { _tag: "ReplyError", expected: "blob" },
    );
  }),
);

it.effect("DIALECT: Kvrocks FUNCTION LOAD retains its empty acknowledgment", () =>
  Effect.gen(function* () {
    const command = yield* Commands.functionLoad("source").prepare;

    expect(yield* command.decode({ _tag: "SimpleString", value: bytes("") })).toBe("");
    expect(yield* command.decode(blob("library"))).toBe("library");
    expect(yield* Effect.flip(command.decode({ _tag: "Integer", value: 1n }))).toMatchObject({
      _tag: "ReplyError",
    });
  }),
);

it.effect("DIALECT: Dragonfly ZDIFF single-member rows reject mixed or oversized rows", () =>
  Effect.gen(function* () {
    const command = yield* Commands.zdiff(["k"]).prepare;

    expect(yield* command.decode(array(array(blob("a")), array(blob("b"))))).toEqual([
      bytes("a"),
      bytes("b"),
    ]);
    for (const reply of [array(array(blob("a"), blob("b"))), array(array(blob("a")), blob("b"))]) {
      expect(yield* Effect.flip(command.decode(reply))).toMatchObject({
        _tag: "ReplyError",
        expected: "array-length",
      });
    }
  }),
);

it.effect("DIALECT: counted LPOS decimal replies reject invalid and overflowing positions", () =>
  Effect.gen(function* () {
    const command = yield* Commands.lposCount("k", "v", 0).prepare;

    for (const token of ["-1", "1.5", "18446744073709551616", "not-a-position"]) {
      expect(yield* Effect.flip(command.decode(array(blob(token))))).toMatchObject({
        _tag: "ReplyError",
        path: [0],
      });
    }
  }),
);
