import { expect, it } from "@effect/vitest";
import { Inspectable, Redacted } from "effect";

import { monitorRecord } from "#/diagnostics/MonitorRecord";
import { blob, bytes, integer } from "#test/support/commands/CoreCase";

it("MONITOR: exact time/database and escaped payloads stay distinct and redacted", () => {
  const result = monitorRecord({
    _tag: "SimpleString",
    value: bytes('1723000000.123456 [2 [::1]:123] "SET" "private-key" "\\xff"'),
  });

  // IPv6 client text also contains brackets; the first ']' does not end the outer header.
  expect(result._tag).toBe("Command");
  if (result._tag !== "Command") return;

  expect(result.timestamp).toBe("1723000000.123456");
  expect(result.database).toBe(2n);
  expect(Redacted.value(result.client)).toBe("[::1]:123");
  expect(Redacted.value(result.commandLine)).toContain("\\xff");
  expect(Inspectable.toStringUnknown(result)).not.toContain("private-key");
});

it.each([
  blob("future"),
  integer(1n),
  { _tag: "SimpleString" as const, value: bytes("future format") },
  { _tag: "SimpleString" as const, value: new Uint8Array([255]) },
])("MONITOR: unrecognized diagnostic frames stay lossless", (reply) => {
  const result = monitorRecord(reply);
  expect(result._tag).toBe("Unknown");
  expect(Redacted.value(result.raw)).toEqual(reply);
});
