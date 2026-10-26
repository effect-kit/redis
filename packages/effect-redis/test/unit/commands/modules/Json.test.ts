import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option, Schema } from "effect";

import { decodeReply } from "#/command/Decode";
import { Commands, PayloadCodec } from "#/index";
import type { RespValue } from "#/index";

const blob = (value: string): RespValue => ({
  _tag: "BlobString",
  value: new TextEncoder().encode(value),
});

it.effect("JSON numeric mutations retain exact tokens across serialized and native replies", () =>
  Effect.gen(function* () {
    const intent = yield* Commands.jsonNumincrby("doc", "$.number", 1).prepare;
    const expected = Option.some([Option.some("9007199254740993"), Option.none()]);
    expect(yield* decodeReply(intent, blob("[9007199254740993,null]"))).toEqual(expected);
    expect(
      yield* decodeReply(intent, {
        _tag: "Array",
        values: [
          { _tag: "Integer", value: 9007199254740993n },
          { _tag: "Null", kind: "resp3" },
        ],
      }),
    ).toEqual(expected);
    expect((yield* Effect.flip(decodeReply(intent, blob("[1,invalid]"))))._tag).toBe("ReplyError");
  }),
);

it.effect(
  "JSONPath replies distinguish absent keys, empty matches and incompatible matched values",
  () =>
    Effect.gen(function* () {
      const intent = yield* Commands.jsonArrlen("doc", "$..array").prepare;
      expect(yield* decodeReply(intent, { _tag: "Null", kind: "bulk" })).toEqual(Option.none());
      expect(yield* decodeReply(intent, { _tag: "Array", values: [] })).toEqual(Option.some([]));
      expect(
        yield* decodeReply(intent, {
          _tag: "Array",
          values: [
            { _tag: "Integer", value: 0n },
            { _tag: "Null", kind: "resp3" },
          ],
        }),
      ).toEqual(Option.some([Option.some(0n), Option.none()]));
      expect((yield* Effect.flip(Commands.jsonArrlenLegacy("doc", "$.array").prepare))._tag).toBe(
        "CommandInputError",
      );
    }),
);

it.effect("JSON Schema codecs are explicit and preserve JSON null as an existing payload", () =>
  Effect.gen(function* () {
    const codec = PayloadCodec.json(Schema.NullOr(Schema.String));
    const intent = yield* Commands.jsonGetWith("doc", codec).prepare;
    expect(yield* decodeReply(intent, blob("null"))).toEqual(Option.some(null));
    expect(yield* decodeReply(intent, { _tag: "Null", kind: "bulk" })).toEqual(Option.none());
    expect((yield* Effect.flip(decodeReply(intent, blob("42"))))._tag).toBe("PayloadError");

    const write = yield* Commands.jsonSetWith("doc", "$", "value", codec).prepare;
    expect(write.tokens).toEqual(["JSON.SET", "doc", "$", new TextEncoder().encode('"value"')]);
  }),
);

it.effect("module multi-key routing and reply lengths use the prepared request snapshot", () =>
  Effect.gen(function* () {
    const keys: [string, ...string[]] = ["one", "two"];
    const read = yield* Commands.jsonMget(keys, "$").prepare;
    keys.pop();
    expect(read.routing).toEqual({
      _tag: "Keys",
      keys: [
        { index: 1, access: "read" },
        { index: 2, access: "read" },
      ],
    });
    expect((yield* Effect.flip(decodeReply(read, { _tag: "Array", values: [] })))._tag).toBe(
      "ReplyError",
    );
    const write = yield* Commands.jsonMset([
      ["one", "$", "1"],
      ["two", "$.name", '"x"'],
    ]).prepare;
    expect(write.routing).toEqual({
      _tag: "Keys",
      keys: [
        { index: 1, access: "read-write" },
        { index: 4, access: "read-write" },
      ],
    });
  }),
);

it.effect(
  "Redis-expanded JSON rejects Valkey's serialized interpretation of FORMAT path tokens",
  () =>
    Effect.gen(function* () {
      const intent = yield* Commands.jsonGetExpanded("doc").prepare;
      expect(
        (yield* Effect.flip(decodeReply(intent, blob('{"FORMAT":[],"EXPAND":[]}'))))._tag,
      ).toBe("ReplyError");
      expect(
        yield* decodeReply(intent, {
          _tag: "Array",
          values: [{ _tag: "Array", values: [blob("value")] }],
        }),
      ).toEqual(Option.some([[blob("value")]]));
    }),
);

it.effect(
  "Redis TYPE wrappers and legacy numeric protocol results retain their reviewed meanings",
  () =>
    Effect.gen(function* () {
      const type = yield* Commands.jsonType("j").prepare;
      expect(
        yield* decodeReply(type, {
          _tag: "Array",
          values: [{ _tag: "Array", values: [blob("object")] }],
        }),
      ).toEqual(Option.some([Option.some("object")]));
      expect(
        yield* decodeReply(type, { _tag: "Array", values: [{ _tag: "Null", kind: "resp3" }] }),
      ).toEqual(Option.none());
      const numeric = yield* Commands.jsonNumincrbyLegacy("j", ".n", 1).prepare;
      expect(yield* decodeReply(numeric, blob("2"))).toEqual({
        _tag: "Scalar",
        value: Option.some("2"),
      });
      expect(
        yield* decodeReply(numeric, { _tag: "Array", values: [{ _tag: "Integer", value: 2n }] }),
      ).toEqual({ _tag: "Matches", values: [Option.some("2")] });
    }),
);

it.effect("JSON write options are snapshotted before application encoding suspends", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const options: { condition: "NX" | "XX" } = { condition: "NX" };
    const codec = {
      ...PayloadCodec.json(Schema.String),
      encode: (_value: string) =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as(new TextEncoder().encode('"value"')),
        ),
    };
    const preparing = yield* Effect.forkChild(
      Commands.jsonSetWith("j", "$", "value", codec, options).prepare,
    );
    yield* Deferred.await(started);
    options.condition = "XX";
    yield* Deferred.succeed(release, undefined);

    expect((yield* Fiber.join(preparing)).tokens).toEqual([
      "JSON.SET",
      "j",
      "$",
      new TextEncoder().encode('"value"'),
      "NX",
    ]);
  }),
);
