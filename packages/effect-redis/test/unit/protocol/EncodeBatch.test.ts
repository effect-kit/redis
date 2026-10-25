import { Result } from "effect";

import { expect, it } from "vitest";

import { encodeBatch } from "#/protocol/encodeBatch";

it("SESSION-FENCE: compound frames preserve binary tokens and exact RESP boundaries", () => {
  const prefix = new TextEncoder().encode("*1\r\n$4\r\nPING\r\n*2\r\n$4\r\nECHO\r\n$2\r\n");
  const result = encodeBatch([["PING"], ["ECHO", new Uint8Array([0, 255])]], {
    maxQueuedBytes: 128,
  });
  expect(result).toEqual(Result.succeed(new Uint8Array([...prefix, 0, 255, 13, 10])));
});

it("SESSION-FENCE: the complete compound write must fit the admission budget", () => {
  const encoded = encodeBatch([["PING"], ["PING"]], { maxQueuedBytes: 20 });
  expect(encoded).toMatchObject({
    _tag: "Failure",
    failure: { _tag: "ProtocolError", kind: "LimitExceeded", limit: "maxQueuedBytes" },
  });
  expect(encodeBatch([], {})).toMatchObject({
    _tag: "Failure",
    failure: { kind: "InvalidArguments" },
  });
});
