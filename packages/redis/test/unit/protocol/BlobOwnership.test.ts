import { Result } from "effect";

import { expect, it } from "vitest";

import { makeRespDecoder } from "#/protocol/decode/Decoder";
import type { RespValue } from "#/protocol/RespValue";
import { bytes, failure, joinBytes } from "#test/support/protocol/Decode";

it.each([4097, 65_536, 65_537])(
  "fragmented %s-byte blobs own their complete output across buffer thresholds",
  (length) => {
    const decoder = Result.getOrThrow(makeRespDecoder());
    const payload = Uint8Array.from({ length }, (_, index) => index % 251);
    const wire = joinBytes(bytes(`$${length}\r\n`), payload, bytes("\r\n$3\r\nend\r\n"));
    const decoded: RespValue[] = [];

    for (let offset = 0; offset < wire.length; offset += 4093) {
      const fragment = wire.slice(offset, offset + 4093);
      Result.getOrThrow(decoder.feed(fragment));
      fragment.fill(0);

      while (true) {
        const reply = Result.getOrThrow(decoder.next());
        if (reply === undefined) break;
        decoded.push(reply);
      }
    }

    expect(decoded).toEqual([
      { _tag: "BlobString", value: payload },
      { _tag: "BlobString", value: bytes("end") },
    ]);
    const first = decoded[0];
    if (first?._tag !== "BlobString") throw new Error("Expected blob");
    first.value.fill(0);
    Result.getOrThrow(decoder.feed(bytes("$3\r\nnew\r\n")));
    expect(Result.getOrThrow(decoder.next())).toEqual({ _tag: "BlobString", value: bytes("new") });
    expect(decoded[1]).toEqual({ _tag: "BlobString", value: bytes("end") });
  },
);

it("a bounded blob still rejects missing terminators and incomplete EOF", () => {
  for (const ending of ["x\n", "\r", ""]) {
    const decoder = Result.getOrThrow(makeRespDecoder());
    Result.getOrThrow(decoder.feed(bytes(`$4097\r\n${"a".repeat(4097)}${ending}`)));
    decoder.end();

    expect(failure(decoder.next()).kind).toBe(
      ending === "x\n" ? "InvalidTerminator" : "UnexpectedEnd",
    );
  }
});
