import { Result } from "effect";

import { expect, it } from "vitest";

import { makeRespDecoder } from "#/protocol/decode/Decoder";
import { readLength } from "#/protocol/decode/scalars";
import { bytes, failure } from "#test/support/protocol/Decode";

it.each([
  "",
  "+1",
  "-0",
  " 1",
  "1 ",
  "1.0",
  "\uFEFF1",
  "１２",
  `${"9".repeat(128)}x`,
  `${"9".repeat(128)}\uFEFF`,
])("length headers reject malformed ASCII syntax even after overflow: %j", (length) => {
  for (const marker of ["$", "*", "%", "~", "!", "="]) {
    const decoder = Result.getOrThrow(makeRespDecoder());
    Result.getOrThrow(decoder.feed(bytes(`${marker}${length}\r\n`)));
    expect(failure(decoder.next())).toMatchObject({ kind: "InvalidLength", offset: 0 });
  }
});

it("length arithmetic preserves every supported safe integer", () => {
  for (const count of [0, 1, 99, 65_536, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER])
    expect(readLength(bytes(`000${count}`), Number.MAX_SAFE_INTEGER, 0, "maxBlobBytes")).toBe(
      count,
    );
});

it("length parsing retains leading-zero, overflow and exact null/streamed syntax", () => {
  const decoder = Result.getOrThrow(makeRespDecoder());
  Result.getOrThrow(decoder.feed(bytes("$0003\r\nabc\r\n*-1\r\n$?\r\n;0001\r\nx\r\n;0\r\n")));
  expect(Result.getOrThrow(decoder.next())).toEqual({ _tag: "BlobString", value: bytes("abc") });
  expect(Result.getOrThrow(decoder.next())).toEqual({ _tag: "Null", kind: "array" });
  expect(Result.getOrThrow(decoder.next())).toEqual({ _tag: "BlobString", value: bytes("x") });

  for (const length of ["9007199254740991", "9007199254740992", "9".repeat(128)]) {
    const oversized = Result.getOrThrow(makeRespDecoder());
    Result.getOrThrow(oversized.feed(bytes(`$${length}\r\n`)));
    expect(failure(oversized.next())).toMatchObject({
      kind: "LimitExceeded",
      limit: "maxBlobBytes",
    });
  }
});
