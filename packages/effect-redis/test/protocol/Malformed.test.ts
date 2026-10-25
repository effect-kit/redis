import { expect, it } from "vitest";

import { bytes, malformed } from "#test/support/protocol/Decode";

it.each([
  ["?\r\n", "InvalidType"],
  ["\r\n", "InvalidType"],
  ["+x\n", "InvalidTerminator"],
  ["+x\rx", "InvalidTerminator"],
  ["$1\r\naXX", "InvalidTerminator"],
  ["$-2\r\n", "InvalidLength"],
  ["$EOF:private-replication-marker\r\n", "InvalidLength"],
  ["$+1\r\na\r\n", "InvalidLength"],
  ["$1.5\r\n", "InvalidLength"],
  ["$\r\n", "InvalidLength"],
  ["*+1\r\n", "InvalidLength"],
  ["*-2\r\n", "InvalidLength"],
  ["%-1\r\n", "InvalidLength"],
  ["~-1\r\n", "InvalidLength"],
  ["!-1\r\n", "InvalidLength"],
  ["=?\r\n", "InvalidLength"],
  ["!?\r\n", "InvalidLength"],
  ["|?\r\n", "InvalidLength"],
  [">?\r\n", "InvalidLength"],
  [":\r\n", "InvalidNumber"],
  [":1.0\r\n", "InvalidNumber"],
  [":\ufeff1\r\n", "InvalidNumber"],
  ["$\ufeff1\r\na\r\n", "InvalidLength"],
  ["#\ufefft\r\n", "InvalidBoolean"],
  [",\ufeffnan\r\n", "InvalidNumber"],
  [": 1\r\n", "InvalidNumber"],
  [":9223372036854775808\r\n", "InvalidNumber"],
  [":-9223372036854775809\r\n", "InvalidNumber"],
  ["(1.2\r\n", "InvalidNumber"],
  [",.5\r\n", "InvalidNumber"],
  [",1.\r\n", "InvalidNumber"],
  [",1e\r\n", "InvalidNumber"],
  [",1e309\r\n", "InvalidNumber"],
  [",0x12\r\n", "InvalidNumber"],
  [",nan(bad!)\r\n", "InvalidNumber"],
  ["#true\r\n", "InvalidBoolean"],
  ["#1\r\n", "InvalidBoolean"],
  ["_x\r\n", "InvalidType"],
  ["=3\r\nabc\r\n", "InvalidVerbatim"],
  ["=4\r\ntxt!\r\n", "InvalidVerbatim"],
  [">0\r\n", "InvalidPush"],
  [">1\r\n:1\r\n", "InvalidPush"],
  ["*1\r\n>1\r\n+x\r\n", "InvalidPush"],
  ["|1\r\n+a\r\n>1\r\n+x\r\n+ok\r\n", "InvalidPush"],
  [".\r\n", "InvalidTerminator"],
  ["*1\r\n.\r\n", "InvalidTerminator"],
  ["*?\r\n.x\r\n", "InvalidTerminator"],
  ["%?\r\n+a\r\n.\r\n", "InvalidLength"],
  [";0\r\n", "InvalidType"],
  ["$?\r\n+x\r\n", "InvalidType"],
  ["$?\r\n;-1\r\n", "InvalidLength"],
  ["$?\r\n;1\r\naXX", "InvalidTerminator"],
] as const)("LIMIT-08: %j -> %s", (wire, kind) => {
  expect(malformed(bytes(wire)).kind).toBe(kind);
});

it("LIMIT-09: errors retain safe positions without payloads", () => {
  const error = malformed(bytes("+OK\r\n$secret-password\r\n"));
  expect(error.offset).toBe(5);
  expect(error.kind).toBe("InvalidLength");
  expect(`${error}\n${JSON.stringify(error)}`).not.toContain("secret-password");
});
