import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Commands, Reply } from "#/index";
import type { Command } from "#/index";
import { array, blob, bytes, integer, missing } from "#test/support/commands/CoreCase";

const vectors: ReadonlyArray<Command<unknown>> = [
  Commands.mget(["a", "b"]),
  Commands.hmget("h", ["a", "b"]),
  Commands.smismember("s", ["a", "b"]),
  Commands.hgetdel("h", ["a", "b"]),
  Commands.hgetex("h", ["a", "b"]),
  Commands.hexpire("h", 1, ["a", "b"]),
  Commands.httl("h", ["a", "b"]),
  Commands.zmscore("z", ["a", "b"]),
  Commands.geohash("g", ["a", "b"]),
  Commands.geopos("g", ["a", "b"]),
  Commands.armget("a", [0, 1]),
  Commands.bitfield("b", [{ operation: "GET", encoding: { signed: true, bits: 8 }, offset: 0 }]),
  Commands.bitfieldRo("b", [{ operation: "GET", encoding: { signed: true, bits: 8 }, offset: 0 }]),
];

it.effect.each(vectors)(
  "CORE-REPLIES: missing positional results fail cardinality validation %#",
  (command) =>
    Effect.gen(function* () {
      const prepared = yield* command.prepare;

      expect(yield* Effect.flip(prepared.decode(array()))).toMatchObject({
        _tag: "ReplyError",
        delivery: "replied",
        expected: "array-length",
      });
    }),
);

it.effect("CORE-REPLIES: collection mismatch paths identify the failing nested value", () =>
  Effect.gen(function* () {
    const scored = yield* Effect.flip(
      Reply.pairs(Reply.blob, Reply.scoreToken)(array(array(blob("member"), integer(1n)))),
    );
    const member = yield* Effect.flip(
      Reply.members(Reply.blob)({
        _tag: "Set",
        values: [blob("valid"), integer(1n)],
      }),
    );

    expect(scored.path).toEqual([0, 1]);
    expect(member.path).toEqual([1]);
  }),
);

it.effect("CORE-REPLIES: binary duplicate map keys stay ordered pairs", () =>
  Effect.gen(function* () {
    const key = new Uint8Array([255, 0]);
    const reply = {
      _tag: "Map" as const,
      entries: [
        [{ _tag: "BlobString" as const, value: key }, blob("a")],
        [{ _tag: "BlobString" as const, value: key }, blob("b")],
      ] as const,
    };

    expect(yield* Reply.pairs(Reply.blob, Reply.blob)(reply)).toEqual([
      [key, bytes("a")],
      [key, bytes("b")],
    ]);
  }),
);

it.effect("CORE-REPLIES: malformed score tuples, booleans and scalar nulls remain errors", () =>
  Effect.gen(function* () {
    expect(
      yield* Effect.flip(Reply.pairs(Reply.blob, Reply.scoreToken)(array(blob("member")))),
    ).toMatchObject({ _tag: "ReplyError" });
    expect(
      yield* Effect.flip(
        Reply.pairs(
          Reply.blob,
          Reply.scoreToken,
        )(array(array(blob("m"), blob("1"), blob("extra")))),
      ),
    ).toMatchObject({ _tag: "ReplyError" });
    expect(yield* Effect.flip(Reply.boolean(integer(2n)))).toMatchObject({ _tag: "ReplyError" });
    const field = yield* Commands.bitfield("k", [
      { operation: "GET", encoding: { signed: true, bits: 8 }, offset: 0 },
    ]).prepare;
    expect(yield* Effect.flip(field.decode(array({ _tag: "Null", kind: "array" })))).toMatchObject({
      _tag: "ReplyError",
    });
    expect(yield* field.decode(array(missing))).toEqual([Option.none()]);
  }),
);

it.effect(
  "CORE-REPLIES: unsigned and long-double tokens retain precision across RESP variants",
  () =>
    Effect.gen(function* () {
      const high = 18446744073709551615n;
      expect(yield* Reply.unsigned(blob(String(high)))).toBe(high);
      expect(yield* Reply.unsigned({ _tag: "BigNumber", value: high })).toBe(high);
      expect(yield* Reply.decimalToken(blob("1e+400"))).toBe("1e+400");
      expect(yield* Effect.flip(Reply.scoreToken(blob("1e+400")))).toMatchObject({
        _tag: "ReplyError",
      });
      for (const value of [blob("18446744073709551616"), blob("-1"), blob("1.5"), integer(-1n)])
        expect(yield* Effect.flip(Reply.unsigned(value))).toMatchObject({ _tag: "ReplyError" });
    }),
);
