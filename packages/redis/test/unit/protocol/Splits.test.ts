import { Result } from "effect";

import { describe, expect, it } from "vitest";

import { makeRespDecoder } from "#/protocol/decode/Decoder";
import { values } from "#test/fixtures/protocol/values";
import { decodeChunks, failure } from "#test/support/protocol/Decode";

describe("SPLIT-01: every byte boundary", () => {
  it.each(values)("$name", ({ wire, value }) => {
    for (let cut = 0; cut <= wire.length; cut++) {
      expect(decodeChunks([wire.subarray(0, cut), wire.subarray(cut)])).toEqual([value]);
    }
  });
});

describe("SPLIT-02: one-byte delivery", () => {
  it.each(values)("$name", ({ wire, value }) => {
    expect(decodeChunks(Array.from(wire, (byte) => new Uint8Array([byte])))).toEqual([value]);
  });
});

describe("LIMIT-10: every nonempty truncated prefix", () => {
  it.each(values)("$name", ({ wire }) => {
    for (let cut = 1; cut < wire.length; cut++) {
      const decoder = Result.getOrThrow(makeRespDecoder());

      Result.getOrThrow(decoder.feed(wire.subarray(0, cut)));
      expect(Result.getOrThrow(decoder.next())).toBeUndefined();

      decoder.end();
      const error = failure(decoder.next());

      expect(error.kind).toBe("UnexpectedEnd");
      expect(error.offset).toBe(cut);
      expect(decoder.bufferedBytes).toBe(0);
    }
  });
});
