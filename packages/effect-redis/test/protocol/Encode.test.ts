import { Result } from "effect";

import { expect, it } from "vitest";

import { encodeCommand } from "#/protocol/encode";
import type { RedisCommand } from "#/protocol/encode";
import { bytes, decodeChunks, failure, joinBytes } from "#test/support/protocol/Decode";

it.each([
  { command: ["PING"] as const, frame: "*1\r\n$4\r\nPING\r\n" },
  { command: ["CLIENT", "LIST"] as const, frame: "*2\r\n$6\r\nCLIENT\r\n$4\r\nLIST\r\n" },
  {
    command: ["SET", "greeting", "🙂"] as const,
    frame: "*3\r\n$3\r\nSET\r\n$8\r\ngreeting\r\n$4\r\n🙂\r\n",
  },
  { command: ["SET", "", ""] as const, frame: "*3\r\n$3\r\nSET\r\n$0\r\n\r\n$0\r\n\r\n" },
  { command: ["ECHO", "\ud800"] as const, frame: "*2\r\n$4\r\nECHO\r\n$3\r\n�\r\n" },
])("WIRE-07: exact request $command", ({ command, frame }) => {
  expect(Result.getOrThrow(encodeCommand(command))).toEqual(bytes(frame));
});

it("WIRE-07: binary argument ownership and embedded terminators", () => {
  const binary = new Uint8Array([255, 0, 13, 10]);
  const frame = Result.getOrThrow(encodeCommand(["ECHO", binary]));

  expect(frame).toEqual(joinBytes(bytes("*2\r\n$4\r\nECHO\r\n$4\r\n"), binary, bytes("\r\n")));

  binary.fill(0);

  expect(decodeChunks([frame])).toEqual([
    {
      _tag: "Array",
      values: [
        { _tag: "BlobString", value: bytes("ECHO") },
        { _tag: "BlobString", value: new Uint8Array([255, 0, 13, 10]) },
      ],
    },
  ]);
});

it("LIMIT-11: frame/argument/count budgets include framing overhead", () => {
  expect(Result.getOrThrow(encodeCommand(["PING"], { maxQueuedBytes: 14 })).length).toBe(14);
  expect(failure(encodeCommand(["PING"], { maxQueuedBytes: 13 })).limit).toBe("maxQueuedBytes");
  expect(failure(encodeCommand(["PING"], { maxBlobBytes: 3 })).limit).toBe("maxBlobBytes");
  expect(failure(encodeCommand(["GET", "a"], { maxAggregateEntries: 1 })).limit).toBe(
    "maxAggregateEntries",
  );
  expect(failure(encodeCommand(["PING"], { maxQueuedBytes: 0 })).kind).toBe("InvalidLimits");
  expect(failure(encodeCommand("PING" as unknown as RedisCommand)).kind).toBe("InvalidArguments");
  expect(failure(encodeCommand([] as unknown as RedisCommand)).kind).toBe("InvalidArguments");
  expect(failure(encodeCommand(["ECHO", 123] as unknown as RedisCommand)).kind).toBe(
    "InvalidArguments",
  );
});
