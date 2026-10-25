import { Option } from "effect";

import * as C from "#/commands/bitmaps/index";
import * as H from "#/commands/hyperloglog/index";
import { array, commandCases, integer, missing, ok } from "#test/support/commands/CoreCase";

commandCases("CORE-BITMAPS", [
  {
    label: "GETBIT",
    command: C.getbit("k", 10),
    tokens: ["GETBIT", "k", "10"],
    reply: integer(1n),
    expected: 1,
    keys: [1],
  },
  {
    label: "SETBIT old bit",
    command: C.setbit("k", 10, 1),
    tokens: ["SETBIT", "k", "10", "1"],
    reply: integer(0n),
    expected: 0,
    keys: [1],
  },
  {
    label: "BITCOUNT bit unit",
    command: C.bitcount("k", { start: 0, end: 7, unit: "BIT" }),
    tokens: ["BITCOUNT", "k", "0", "7", "BIT"],
    reply: integer(4n),
    expected: 4n,
    keys: [1],
  },
  {
    label: "BITPOS absent",
    command: C.bitpos("k", 1, { start: -1, end: -1, unit: "BYTE" }),
    tokens: ["BITPOS", "k", "1", "-1", "-1", "BYTE"],
    reply: integer(-1n),
    expected: -1n,
    keys: [1],
  },
  {
    label: "BITOP destination is argument two",
    command: C.bitop("AND", "out", ["a", "b"]),
    tokens: ["BITOP", "AND", "out", "a", "b"],
    reply: integer(1n),
    expected: 1n,
    keys: [2, 3, 4],
  },
  {
    label: "BITFIELD overflow and scaled offsets",
    command: C.bitfield("k", [
      {
        operation: "SET",
        encoding: { signed: false, bits: 3 },
        offset: { index: 1 },
        value: 7,
        overflow: "FAIL",
      },
      { operation: "GET", encoding: { signed: false, bits: 3 }, offset: 3 },
    ]),
    tokens: ["BITFIELD", "k", "OVERFLOW", "FAIL", "SET", "u3", "#1", "7", "GET", "u3", "3"],
    reply: array(missing, integer(7n)),
    expected: [Option.none(), Option.some(7n)],
    keys: [1],
  },
  {
    label: "BITFIELD_RO signed int64",
    command: C.bitfieldRo("k", [
      { operation: "GET", encoding: { signed: true, bits: 64 }, offset: 0 },
    ]),
    tokens: ["BITFIELD_RO", "k", "GET", "i64", "0"],
    reply: array(integer(-9007199254740993n)),
    expected: [-9007199254740993n],
    keys: [1],
  },
]);

commandCases("CORE-HYPERLOGLOG", [
  {
    label: "PFADD empty creates",
    command: H.pfadd("k"),
    tokens: ["PFADD", "k"],
    reply: integer(1n),
    expected: true,
    keys: [1],
  },
  {
    label: "PFCOUNT multi key",
    command: H.pfcount(["a", "b"]),
    tokens: ["PFCOUNT", "a", "b"],
    reply: integer(3n),
    expected: 3n,
    keys: [1, 2],
  },
  {
    label: "PFMERGE destination",
    command: H.pfmerge("out", ["a", "b"]),
    tokens: ["PFMERGE", "out", "a", "b"],
    reply: ok,
    expected: undefined,
    keys: [1, 2, 3],
  },
]);
