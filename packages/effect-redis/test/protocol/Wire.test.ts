import { Result } from "effect";

import { describe, expect, it } from "vitest";

import { makeRespDecoder } from "#/protocol/decode/Decoder";
import { values } from "#test/fixtures/protocol/values";
import { bytes, decodeChunks, failure, joinBytes } from "#test/support/protocol/Decode";

describe("WIRE-01: independent RESP2/3 fixtures", () => {
  it.each(values)("$name", ({ wire, value }) => {
    expect(decodeChunks([wire])).toEqual([value]);
  });
});

it("WIRE-02: coalesced ordinary replies, attributes and pushes retain their order", () => {
  const wire = bytes("+OK\r\n|0\r\n>1\r\n+x\r\n:42\r\n");
  const decoded = decodeChunks([wire]);

  expect(decoded.map((value) => value._tag)).toEqual(["SimpleString", "Attribute", "Integer"]);
  expect(decoded[1]).toEqual({
    _tag: "Attribute",
    entries: [],
    value: { _tag: "Push", values: [{ _tag: "SimpleString", value: bytes("x") }] },
  });
});

it("WIRE-03: input reuse and returned-value mutation cannot corrupt parser-owned state", () => {
  const decoder = Result.getOrThrow(makeRespDecoder());
  const input = bytes("$3\r\nhey\r\n$3\r\nbye\r\n");

  Result.getOrThrow(decoder.feed(input));
  input.fill(0);

  const first = Result.getOrThrow(decoder.next());
  expect(first).toEqual({ _tag: "BlobString", value: bytes("hey") });
  if (first?._tag !== "BlobString") throw new Error("Expected blob");

  first.value.fill(0);
  expect(Result.getOrThrow(decoder.next())).toEqual({ _tag: "BlobString", value: bytes("bye") });
});

it("WIRE-04: metadata does not satisfy the decorated array element prematurely", () => {
  const decoder = Result.getOrThrow(makeRespDecoder());
  Result.getOrThrow(decoder.feed(bytes("*1\r\n|0\r\n")));
  expect(Result.getOrThrow(decoder.next())).toBeUndefined();

  Result.getOrThrow(decoder.feed(bytes("+OK\r\n")));
  expect(Result.getOrThrow(decoder.next())).toEqual({
    _tag: "Array",
    values: [
      { _tag: "Attribute", entries: [], value: { _tag: "SimpleString", value: bytes("OK") } },
    ],
  });
});

it("WIRE-05: binary map keys and streamed binary fragments remain exact", () => {
  const payload = new Uint8Array([255, 0, 13, 10]);
  const wire = joinBytes(
    bytes("%1\r\n$4\r\n"),
    payload,
    bytes("\r\n$?\r\n;4\r\n"),
    payload,
    bytes("\r\n;0\r\n"),
  );

  expect(decodeChunks([wire])).toEqual([
    {
      _tag: "Map",
      entries: [
        [
          { _tag: "BlobString", value: payload },
          { _tag: "BlobString", value: payload },
        ],
      ],
    },
  ]);
});

it("WIRE-06: clean EOF is idempotent and subsequent feeding is terminal misuse", () => {
  const decoder = Result.getOrThrow(makeRespDecoder());
  decoder.end();
  decoder.end();
  expect(Result.getOrThrow(decoder.next())).toBeUndefined();
  expect(failure(decoder.feed(bytes("+OK\r\n"))).kind).toBe("InvalidState");
  expect(failure(decoder.next()).kind).toBe("InvalidState");
});

it("LIMIT-15: invalid byte input is a safe terminal API failure", () => {
  const decoder = Result.getOrThrow(makeRespDecoder());
  const error = failure(decoder.feed("secret" as unknown as Uint8Array));

  expect(error.kind).toBe("InvalidArguments");
  expect(String(error)).not.toContain("secret");
  expect(failure(decoder.next())).toBe(error);
});
