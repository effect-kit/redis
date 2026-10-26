import type { RespValue } from "#/protocol/RespValue";
import { bytes, joinBytes } from "#test/support/protocol/Decode";

export interface WireFixture {
  readonly name: string;
  readonly wire: Uint8Array;
  readonly value: RespValue;
}

const simple = (value: string): RespValue => ({ _tag: "SimpleString", value: bytes(value) });
const integer = (value: bigint): RespValue => ({ _tag: "Integer", value });

// Authored from the RESP grammar, independently of the production encoder.
export const values: ReadonlyArray<WireFixture> = [
  { name: "simple", wire: bytes("+OK\r\n"), value: simple("OK") },
  { name: "empty simple", wire: bytes("+\r\n"), value: simple("") },
  {
    name: "server error",
    wire: bytes("-WRONGTYPE synthetic\r\n"),
    value: { _tag: "SimpleError", value: bytes("WRONGTYPE synthetic") },
  },
  {
    name: "empty blob",
    wire: bytes("$0\r\n\r\n"),
    value: { _tag: "BlobString", value: bytes("") },
  },
  {
    name: "unicode blob",
    wire: bytes("$4\r\n🙂\r\n"),
    value: { _tag: "BlobString", value: bytes("🙂") },
  },
  {
    name: "binary blob",
    wire: joinBytes(bytes("$5\r\n"), new Uint8Array([0, 255, 13, 10, 128]), bytes("\r\n")),
    value: { _tag: "BlobString", value: new Uint8Array([0, 255, 13, 10, 128]) },
  },
  {
    name: "blob error",
    wire: bytes("!5\r\nERR x\r\n"),
    value: { _tag: "BlobError", value: bytes("ERR x") },
  },
  {
    name: "verbatim",
    wire: bytes("=7\r\ntxt:hey\r\n"),
    value: { _tag: "VerbatimString", format: bytes("txt"), value: bytes("hey") },
  },
  {
    name: "empty verbatim",
    wire: bytes("=4\r\nmkd:\r\n"),
    value: { _tag: "VerbatimString", format: bytes("mkd"), value: bytes("") },
  },
  {
    name: "minimum integer",
    wire: bytes(":-9223372036854775808\r\n"),
    value: integer(-9223372036854775808n),
  },
  {
    name: "maximum integer",
    wire: bytes(":9223372036854775807\r\n"),
    value: integer(9223372036854775807n),
  },
  {
    name: "unsafe JS integer",
    wire: bytes(":9007199254740993\r\n"),
    value: integer(9007199254740993n),
  },
  { name: "explicit positive integer", wire: bytes(":+123\r\n"), value: integer(123n) },
  {
    name: "big number",
    wire: bytes("(99999999999999999999999999999\r\n"),
    value: { _tag: "BigNumber", value: 99999999999999999999999999999n },
  },
  {
    name: "negative big number",
    wire: bytes("(-99999999999999999999999999999\r\n"),
    value: { _tag: "BigNumber", value: -99999999999999999999999999999n },
  },
  ...[
    "-0",
    "1.234567890123456789",
    "1.25e+10",
    "-1E-20",
    "inf",
    "-inf",
    "nan",
    "-nan",
    "NAN",
    "nan(payload)",
  ].map((token): WireFixture => ({
    name: `double ${token}`,
    wire: bytes(`,${token}\r\n`),
    value: { _tag: "Double", value: token },
  })),
  { name: "true", wire: bytes("#t\r\n"), value: { _tag: "Boolean", value: true } },
  { name: "false", wire: bytes("#f\r\n"), value: { _tag: "Boolean", value: false } },
  { name: "RESP3 null", wire: bytes("_\r\n"), value: { _tag: "Null", kind: "resp3" } },
  { name: "RESP2 bulk null", wire: bytes("$-1\r\n"), value: { _tag: "Null", kind: "bulk" } },
  { name: "RESP2 array null", wire: bytes("*-1\r\n"), value: { _tag: "Null", kind: "array" } },
  { name: "empty array", wire: bytes("*0\r\n"), value: { _tag: "Array", values: [] } },
  { name: "empty map", wire: bytes("%0\r\n"), value: { _tag: "Map", entries: [] } },
  { name: "empty set", wire: bytes("~0\r\n"), value: { _tag: "Set", values: [] } },
  {
    name: "nested error",
    wire: bytes("*2\r\n:1\r\n-ERR x\r\n"),
    value: { _tag: "Array", values: [integer(1n), { _tag: "SimpleError", value: bytes("ERR x") }] },
  },
  {
    name: "duplicate map keys",
    wire: bytes("%2\r\n+a\r\n:1\r\n+a\r\n:2\r\n"),
    value: {
      _tag: "Map",
      entries: [
        [simple("a"), integer(1n)],
        [simple("a"), integer(2n)],
      ],
    },
  },
  {
    name: "duplicate set values",
    wire: bytes("~2\r\n+a\r\n+a\r\n"),
    value: { _tag: "Set", values: [simple("a"), simple("a")] },
  },
  {
    name: "root attribute",
    wire: bytes("|1\r\n+ttl\r\n:3\r\n+OK\r\n"),
    value: { _tag: "Attribute", entries: [[simple("ttl"), integer(3n)]], value: simple("OK") },
  },
  {
    name: "nested attribute",
    wire: bytes("*2\r\n:1\r\n|0\r\n:2\r\n"),
    value: {
      _tag: "Array",
      values: [integer(1n), { _tag: "Attribute", entries: [], value: integer(2n) }],
    },
  },
  {
    name: "consecutive attributes",
    wire: bytes("|0\r\n|0\r\n:1\r\n"),
    value: {
      _tag: "Attribute",
      entries: [],
      value: { _tag: "Attribute", entries: [], value: integer(1n) },
    },
  },
  {
    name: "push",
    wire: bytes(">2\r\n+message\r\n+x\r\n"),
    value: { _tag: "Push", values: [simple("message"), simple("x")] },
  },
  {
    name: "attributed push",
    wire: bytes("|0\r\n>1\r\n+invalidate\r\n"),
    value: {
      _tag: "Attribute",
      entries: [],
      value: { _tag: "Push", values: [simple("invalidate")] },
    },
  },
  {
    name: "streamed blob",
    wire: bytes("$?\r\n;2\r\nhe\r\n;3\r\nllo\r\n;0\r\n"),
    value: { _tag: "BlobString", value: bytes("hello") },
  },
  {
    name: "empty streamed blob",
    wire: bytes("$?\r\n;0\r\n"),
    value: { _tag: "BlobString", value: bytes("") },
  },
  {
    name: "streamed array",
    wire: bytes("*?\r\n:1\r\n:2\r\n.\r\n"),
    value: { _tag: "Array", values: [integer(1n), integer(2n)] },
  },
  {
    name: "streamed map",
    wire: bytes("%?\r\n+a\r\n:1\r\n.\r\n"),
    value: { _tag: "Map", entries: [[simple("a"), integer(1n)]] },
  },
  {
    name: "streamed set",
    wire: bytes("~?\r\n:1\r\n.\r\n"),
    value: { _tag: "Set", values: [integer(1n)] },
  },
  {
    name: "empty streamed array",
    wire: bytes("*?\r\n.\r\n"),
    value: { _tag: "Array", values: [] },
  },
  {
    name: "mixed aggregate forms",
    wire: bytes("*?\r\n%1\r\n+a\r\n~?\r\n#t\r\n.\r\n.\r\n"),
    value: {
      _tag: "Array",
      values: [
        {
          _tag: "Map",
          entries: [[simple("a"), { _tag: "Set", values: [{ _tag: "Boolean", value: true }] }]],
        },
      ],
    },
  },
  { name: "unicode simple", wire: bytes("+é🙂\r\n"), value: simple("é🙂") },
  {
    name: "BOM blob",
    wire: bytes("$4\r\n\ufeffA\r\n"),
    value: { _tag: "BlobString", value: bytes("\ufeffA") },
  },
  {
    name: "Redis-style blob push",
    wire: bytes(">3\r\n$7\r\nmessage\r\n$1\r\nc\r\n$1\r\nv\r\n"),
    value: {
      _tag: "Push",
      values: ["message", "c", "v"].map((text) => ({ _tag: "BlobString", value: bytes(text) })),
    },
  },
];
