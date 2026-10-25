import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Commands } from "#/index";
import type { AddId, Command } from "#/index";
import {
  array,
  blob,
  bytes,
  commandCases,
  integer,
  missing,
  ok,
} from "#test/support/commands/CoreCase";

const payload = [
  ["f", "v"],
  ["f", "w"],
] as const;
const entry = array(blob("9007199254740993-7"), array(blob("f"), blob("v"), blob("f"), blob("w")));
const expected = {
  id: "9007199254740993-7",
  fields: [
    [bytes("f"), bytes("v")],
    [bytes("f"), bytes("w")],
  ],
};

commandCases("STREAM-ENTRIES", [
  {
    label: "XADD fields",
    command: Commands.xadd("s", "*", payload),
    tokens: ["XADD", "s", "*", "f", "v", "f", "w"],
    reply: blob("9007199254740993-7"),
    expected: "9007199254740993-7",
    keys: [1],
  },
  {
    label: "XADD existing",
    command: Commands.xaddIfExists("s", "*", payload),
    tokens: ["XADD", "s", "NOMKSTREAM", "*", "f", "v", "f", "w"],
    reply: missing,
    expected: Option.none(),
    keys: [1],
  },
  {
    label: "XADD versioned flags",
    command: Commands.xadd("s", "1-*", [["f", "v"]], {
      references: "DELREF",
      idempotency: { mode: "IDMP", producer: "p", id: "i" },
      trim: { by: "MAXLEN", threshold: 2, approximate: true, limit: 0 },
    }),
    tokens: [
      "XADD",
      "s",
      "DELREF",
      "IDMP",
      "p",
      "i",
      "MAXLEN",
      "~",
      "2",
      "LIMIT",
      "0",
      "1-*",
      "f",
      "v",
    ],
    reply: blob("1-0"),
    expected: "1-0",
    keys: [1],
  },
  {
    label: "XRANGE exclusive bound",
    command: Commands.xrange("s", "(1-0", "+", { count: 2 }),
    tokens: ["XRANGE", "s", "(1-0", "+", "COUNT", "2"],
    reply: array(entry),
    expected: [expected],
    keys: [1],
  },
  {
    label: "XREVRANGE",
    command: Commands.xrevrange("s", "+", "0"),
    tokens: ["XREVRANGE", "s", "+", "0"],
    reply: array(entry),
    expected: [expected],
    keys: [1],
  },
  {
    label: "XLEN",
    command: Commands.xlen("s"),
    tokens: ["XLEN", "s"],
    reply: integer(9007199254740993n),
    expected: 9007199254740993n,
    keys: [1],
  },
  {
    label: "XCFGSET",
    command: Commands.xcfgset("s", { idmpDurationSeconds: 60, idmpMaxSize: 100 }),
    tokens: ["XCFGSET", "s", "IDMP-DURATION", "60", "IDMP-MAXSIZE", "100"],
    reply: ok,
    expected: undefined,
    keys: [1],
  },
]);

const invalid: ReadonlyArray<Command<unknown>> = [
  Commands.xadd("s", "-1-0" as AddId, [["f", "v"]]),
  Commands.xadd("s", "18446744073709551616-0", [["f", "v"]]),
  Commands.xadd("s", "0-18446744073709551616", [["f", "v"]]),
  Commands.xadd("s", "*", [["f", "v"]], { trim: { by: "MAXLEN", threshold: 1, limit: 1 } }),
  Commands.xcfgset("s", {}),
];
it.effect.each(invalid)("STREAM-INPUT: invalid ID/trim/config fails unsent %#", (command) =>
  Effect.gen(function* () {
    expect(yield* Effect.flip(command.prepare)).toMatchObject({
      _tag: "CommandInputError",
      delivery: "unsent",
    });
  }),
);

it.effect("STREAM-REPLY: malformed IDs and odd field vectors fail at their nested path", () =>
  Effect.gen(function* () {
    const prepared = yield* Commands.xrange("s").prepare;
    const badId = array(array(blob("bad"), array()));
    const oddFields = array(array(blob("1-0"), array(blob("f"))));
    expect(yield* Effect.flip(prepared.decode(badId))).toMatchObject({
      _tag: "ReplyError",
      path: [0, 0],
    });
    expect(yield* Effect.flip(prepared.decode(oddFields))).toMatchObject({
      _tag: "ReplyError",
      path: [0, 1],
    });
  }),
);
