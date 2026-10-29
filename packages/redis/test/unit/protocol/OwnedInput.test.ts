import { Result } from "effect";

import { expect, it } from "vitest";

import { makeOwnedRespDecoder } from "#/protocol/decode/Decoder";
import { decodeLimits } from "#/protocol/limits";
import { bytes } from "#test/support/protocol/Decode";

const limits = Result.getOrThrow(decodeLimits());

it("transferred fragments never alias completed values or become reused scratch", () => {
  const wire = bytes("*2\r\n$3\r\none\r\n$3\r\ntwo\r\n");

  for (let split = 0; split <= wire.length; split++) {
    const decoder = Result.getOrThrow(makeOwnedRespDecoder(limits));
    const first = wire.slice(0, split);
    const second = wire.slice(split);
    Result.getOrThrow(decoder.feed(first));
    const early = Result.getOrThrow(decoder.next());
    Result.getOrThrow(decoder.feed(second));
    const reply = early ?? Result.getOrThrow(decoder.next());
    const consumedFirst = first.slice();
    const consumedSecond = second.slice();

    expect(reply).toEqual({
      _tag: "Array",
      values: [
        { _tag: "BlobString", value: bytes("one") },
        { _tag: "BlobString", value: bytes("two") },
      ],
    });

    Result.getOrThrow(decoder.feed(bytes("$3\r\nnew\r\n")));
    expect(Result.getOrThrow(decoder.next())).toEqual({ _tag: "BlobString", value: bytes("new") });
    expect(first).toEqual(consumedFirst);
    expect(second).toEqual(consumedSecond);
    first.fill(255);
    second.fill(255);
    expect(reply?._tag === "Array" && reply.values[0]).toEqual({
      _tag: "BlobString",
      value: bytes("one"),
    });
  }
});

it.each([65_537, 1024 * 1024])(
  "small views do not transfer a %s-byte backing allocation",
  (size) => {
    const decoder = Result.getOrThrow(makeOwnedRespDecoder(limits));
    const backing = new Uint8Array(size).fill(19);
    const wire = bytes("$3\r\none\r\n");
    backing.set(wire, 17);
    const view = backing.subarray(17, 17 + wire.length);
    Result.getOrThrow(decoder.feed(view));
    backing.fill(0);

    expect(Result.getOrThrow(decoder.next())).toEqual({ _tag: "BlobString", value: bytes("one") });
  },
);

it("owned input also respects a smaller configured backing-storage budget", () => {
  const decoder = Result.getOrThrow(
    makeOwnedRespDecoder({ ...limits, maxBufferedBytes: 32, maxBlobBytes: 16, maxHeaderBytes: 8 }),
  );
  const backing = new Uint8Array(64);
  const wire = bytes("+OK\r\n");
  backing.set(wire);
  Result.getOrThrow(decoder.feed(backing.subarray(0, wire.length)));
  backing.fill(0);

  expect(Result.getOrThrow(decoder.next())).toEqual({ _tag: "SimpleString", value: bytes("OK") });
});
