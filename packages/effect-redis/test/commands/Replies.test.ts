import { expect, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";

import * as Reply from "#/command/Reply";
import { ReplyError } from "#/errors/ReplyError";
import type { RespValue } from "#/protocol/RespValue";

const bytes = (text: string) => new TextEncoder().encode(text);
it.effect("COMMAND-02: optional blobs distinguish missing, empty and binary values", () =>
  Effect.gen(function* () {
    for (const kind of ["bulk", "resp3"] as const)
      expect(yield* Reply.optional(Reply.blob)({ _tag: "Null", kind })).toEqual(Option.none());
    for (const value of [new Uint8Array(), new Uint8Array([255, 0, 128])])
      expect(yield* Reply.optional(Reply.blob)({ _tag: "BlobString", value })).toEqual(
        Option.some(value),
      );
    expect(
      (yield* Effect.flip(Reply.optional(Reply.blob)({ _tag: "Null", kind: "array" })))._tag,
    ).toBe("ReplyError");
  }),
);
it.effect("COMMAND-03: text is strict UTF-8 and preserves a leading BOM", () =>
  Effect.gen(function* () {
    expect(yield* Reply.text({ _tag: "BlobString", value: bytes("\ufeffé🦊") })).toBe("\ufeffé🦊");
    const failure = yield* Effect.flip(
      Reply.text({ _tag: "BlobString", value: new Uint8Array([0xc3, 0x28]) }),
    );
    expect(failure).toMatchObject({ _tag: "ReplyError", expected: "text", delivery: "replied" });
  }),
);
it.effect.each([
  -9223372036854775808n,
  -9007199254740993n,
  0n,
  9007199254740993n,
  9223372036854775807n,
])("COMMAND-04: integer decoding retains exact signed values %s", (value) =>
  Effect.gen(function* () {
    expect(yield* Reply.integer({ _tag: "Integer", value })).toBe(value);
    const checked = yield* Effect.result(Reply.safeInteger({ _tag: "Integer", value }));
    expect(Result.isSuccess(checked)).toBe(
      value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER),
    );
  }),
);
it.effect.each(["0", "-0", "1.2345678901234567", "1e-300", "+inf", "-inf"])(
  "COMMAND-05: score token survives RESP2 and RESP3 decoding %s",
  (token) =>
    Effect.gen(function* () {
      for (const reply of [
        { _tag: "Double", value: token },
        { _tag: "BlobString", value: bytes(token) },
      ] satisfies RespValue[]) {
        expect(yield* Reply.scoreToken(reply)).toBe(token);
        const expected = token === "+inf" ? Infinity : token === "-inf" ? -Infinity : Number(token);
        expect(yield* Reply.score(reply)).toBe(expected);
      }
    }),
);
it.effect.each(["nan", "NaN", "Infinity", "1x", "", " 1", "1e9999"])(
  "COMMAND-05: rejects invalid or overflowing score token %j",
  (token) =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(Reply.score({ _tag: "BlobString", value: bytes(token) })),
      ).toBeInstanceOf(ReplyError);
    }),
);
it.effect("COMMAND-10: attributes decode without flattening nested error values", () =>
  Effect.gen(function* () {
    const decorated: RespValue = {
      _tag: "Attribute",
      entries: [],
      value: { _tag: "Integer", value: 7n },
    };
    expect(yield* Reply.integer(decorated)).toBe(7n);
    const nested: RespValue = {
      _tag: "Array",
      values: [
        { _tag: "Integer", value: 1n },
        { _tag: "BlobError", value: bytes("ERR synthetic") },
      ],
    };
    expect(yield* Effect.flip(Reply.array(Reply.integer)(nested))).toMatchObject({
      expected: "integer",
      actual: "BlobError",
      path: [1],
    });
    expect(
      yield* Effect.flip(Reply.integer({ _tag: "BlobString", value: bytes("123") })),
    ).toMatchObject({ expected: "integer" });
    expect(
      yield* Effect.flip(Reply.status("OK")({ _tag: "SimpleString", value: bytes("PONG") })),
    ).toMatchObject({ expected: "status" });
  }),
);
