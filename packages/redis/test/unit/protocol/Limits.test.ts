import { Result } from "effect";

import { expect, it } from "vitest";

import { makeRespDecoder } from "#/protocol/decode/Decoder";
import { bytes, decodeChunks, failure, malformed } from "#test/support/protocol/Decode";

it("LIMIT-01: header size includes marker and excludes CRLF", () => {
  const options = { maxHeaderBytes: 3, maxBlobBytes: 3, maxBufferedBytes: 32 };

  expect(decodeChunks([bytes("+OK\r\n")], options)).toHaveLength(1);
  expect(malformed(bytes("+OK\r\n"), { ...options, maxHeaderBytes: 2 }).limit).toBe(
    "maxHeaderBytes",
  );
  expect(
    decodeChunks([bytes("_\r\n")], { maxHeaderBytes: 1, maxBlobBytes: 1, maxBufferedBytes: 3 }),
  ).toEqual([{ _tag: "Null", kind: "resp3" }]);
});

it("LIMIT-02: blob declarations and streamed totals are bounded before payload allocation", () => {
  const options = { maxBlobBytes: 3 };

  expect(decodeChunks([bytes("$3\r\nabc\r\n")], options)).toHaveLength(1);
  expect(malformed(bytes("$4\r\n"), options).limit).toBe("maxBlobBytes");
  expect(malformed(bytes("$999999999999999999999999999\r\n"), options).limit).toBe("maxBlobBytes");

  expect(decodeChunks([bytes("$?\r\n;1\r\na\r\n;2\r\nbc\r\n;0\r\n")], options)).toHaveLength(1);
  expect(malformed(bytes("$?\r\n;2\r\nab\r\n;2\r\n"), options).limit).toBe("maxBlobBytes");
});

it("LIMIT-03: total aggregate child slots include nested values and two slots per map pair", () => {
  expect(decodeChunks([bytes("*2\r\n:1\r\n:2\r\n")], { maxAggregateEntries: 2 })).toHaveLength(1);
  expect(malformed(bytes("*3\r\n"), { maxAggregateEntries: 2 }).limit).toBe("maxAggregateEntries");

  expect(decodeChunks([bytes("%1\r\n+a\r\n:1\r\n")], { maxAggregateEntries: 2 })).toHaveLength(1);
  expect(malformed(bytes("%2\r\n"), { maxAggregateEntries: 3 }).limit).toBe("maxAggregateEntries");

  const nested = bytes("*2\r\n*1\r\n:1\r\n*0\r\n");

  expect(decodeChunks([nested], { maxAggregateEntries: 3 })).toHaveLength(1);
  expect(malformed(nested, { maxAggregateEntries: 2 }).limit).toBe("maxAggregateEntries");
  expect(malformed(bytes("*?\r\n:1\r\n:2\r\n:3\r\n.\r\n"), { maxAggregateEntries: 2 }).limit).toBe(
    "maxAggregateEntries",
  );
});

it("LIMIT-04: nesting includes empty aggregates and attribute chains", () => {
  expect(decodeChunks([bytes("*1\r\n*0\r\n")], { maxNestingDepth: 2 })).toHaveLength(1);
  expect(malformed(bytes("*1\r\n*0\r\n"), { maxNestingDepth: 1 }).limit).toBe("maxNestingDepth");
  expect(malformed(bytes("|0\r\n|0\r\n+OK\r\n"), { maxNestingDepth: 1 }).limit).toBe(
    "maxNestingDepth",
  );
  expect(malformed(bytes("*?\r\n*?\r\n.\r\n.\r\n"), { maxNestingDepth: 1 }).limit).toBe(
    "maxNestingDepth",
  );
});

it("LIMIT-05: retained incomplete aggregates count toward wire-byte retention", () => {
  const decoder = Result.getOrThrow(
    makeRespDecoder({ maxHeaderBytes: 4, maxBlobBytes: 8, maxBufferedBytes: 20 }),
  );

  const first = bytes("*2\r\n$3\r\nabc\r\n");
  Result.getOrThrow(decoder.feed(first));
  expect(Result.getOrThrow(decoder.next())).toBeUndefined();
  expect(decoder.bufferedBytes).toBe(first.length);

  const error = failure(decoder.feed(bytes("$3\r\ndef\r\n")));
  expect(error.limit).toBe("maxBufferedBytes");
  expect(decoder.bufferedBytes).toBe(0);
  expect(failure(decoder.next())).toBe(error);
});

it("LIMIT-06: exact feed budget, draining and coalesced values", () => {
  const options = { maxHeaderBytes: 3, maxBlobBytes: 1, maxBufferedBytes: 5 };
  const decoder = Result.getOrThrow(makeRespDecoder(options));

  for (let index = 0; index < 10_000; index++) {
    Result.getOrThrow(decoder.feed(bytes("+OK\r\n")));
    expect(Result.getOrThrow(decoder.next())).toBeDefined();
    expect(decoder.bufferedBytes).toBe(0);
  }
  expect(malformed(bytes("+OK\r\n"), { ...options, maxBufferedBytes: 4 }).limit).toBe(
    "maxBufferedBytes",
  );

  const many = bytes("+x\r\n".repeat(5000));
  expect(
    decodeChunks([many], { maxHeaderBytes: 2, maxBlobBytes: 1, maxBufferedBytes: many.length }),
  ).toHaveLength(5000);
});

it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  "LIMIT-07: rejects invalid protocol budgets %s",
  (value) => {
    for (const field of [
      "maxHeaderBytes",
      "maxBlobBytes",
      "maxBufferedBytes",
      "maxAggregateEntries",
      "maxNestingDepth",
    ]) {
      expect(failure(makeRespDecoder({ [field]: value })).kind).toBe("InvalidLimits");
    }
  },
);
