import { it } from "@effect/vitest";
import { Result, Schema } from "effect";

import { expect } from "vitest";

import { ProtocolError } from "#/errors/ProtocolError";
import { makeRespDecoder } from "#/protocol/decode/Decoder";
import { encodeCommand } from "#/protocol/encode";
import { bytes, decodeChunks } from "#test/support/protocol/Decode";
import { generatedValue, wireValue } from "#test/support/protocol/GeneratedValue";

const Binary = Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))).check(
  Schema.isMaxLength(40),
);
const Text = Schema.String.check(Schema.isMaxLength(32));

const Partitions = Schema.Array(
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 19 })),
).check(Schema.isMaxLength(20));

const partition = (wire: Uint8Array, sizes: ReadonlyArray<number>): Array<Uint8Array> => {
  const chunks: Array<Uint8Array> = [];
  let offset = 0;
  let index = 0;

  while (offset < wire.length) {
    const width = sizes[index++ % sizes.length] ?? 7;
    chunks.push(wire.subarray(offset, offset + width));
    offset += width;
  }

  return chunks;
};

it.prop(
  "WIRE-08: UTF-8 lengths and arbitrary binary command tokens",
  [Text, Binary, Partitions],
  ([text, binary, splits]) => {
    const payload = Uint8Array.from(binary);
    const wire = Result.getOrThrow(encodeCommand(["ECHO", text, payload]));
    // Fixed token framing is counted separately from the UTF-8 and binary payloads.
    const headerLength =
      4 + 10 + bytes(text).length.toString().length + 5 + payload.length.toString().length + 5;

    expect(wire.length).toBe(headerLength + bytes(text).length + payload.length);
    expect(decodeChunks(partition(wire, splits))).toEqual([
      {
        _tag: "Array",
        values: [
          { _tag: "BlobString", value: bytes("ECHO") },
          { _tag: "BlobString", value: bytes(text) },
          { _tag: "BlobString", value: payload },
        ],
      },
    ]);
  },
  { arbitrary: { runs: 300, size: 32, seed: "resp-command-02" } },
);

it.prop(
  "SPLIT-03: bounded nested values survive fixed/streamed encodings and chunk partitions",
  [
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 200 })),
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
    Binary,
    Partitions,
  ],
  ([selector, depth, binary, splits]) => {
    const value = generatedValue(selector, depth, Uint8Array.from(binary));

    for (const streamed of [false, true]) {
      expect(decodeChunks(partition(wireValue(value, streamed), splits))).toEqual([value]);
    }
  },
  { arbitrary: { runs: 500, size: 32, seed: "resp-values-02" } },
);

it.prop(
  "LIMIT-12: arbitrary byte input terminates with values or typed terminal failures",
  [Binary],
  ([binary]) => {
    const wire = Uint8Array.from(binary);
    const decoder = Result.getOrThrow(
      makeRespDecoder({
        maxHeaderBytes: 32,
        maxBlobBytes: 64,
        maxBufferedBytes: 128,
        maxAggregateEntries: 16,
        maxNestingDepth: 8,
      }),
    );

    Result.getOrThrow(decoder.feed(wire));
    decoder.end();

    for (let count = 0; count <= wire.length; count++) {
      const result = decoder.next();
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(ProtocolError);
        expect(decoder.bufferedBytes).toBe(0);
        return;
      }
      if (result.success === undefined) {
        expect(decoder.bufferedBytes).toBe(0);
        return;
      }
    }

    throw new Error("Decoder emitted more values than input bytes");
  },
  { arbitrary: { runs: 500, size: 40, seed: "resp-malformed-02" } },
);
