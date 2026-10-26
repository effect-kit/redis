import { expect, it } from "@effect/vitest";
import { Duration, Effect, Option } from "effect";

import { Commands } from "#/index";
import {
  array,
  blob,
  bytes,
  commandCases,
  integer,
  missing,
} from "#test/support/commands/CoreCase";

const payload = array(blob("f"), blob("v"));
commandCases("STREAM-READ", [
  {
    label: "XREAD multikey",
    command: Commands.xread(
      [
        ["a", "0"],
        ["b", "+"],
      ],
      { count: 2, maxCount: 3, maxSize: 100 },
    ),
    tokens: [
      "XREAD",
      "COUNT",
      "2",
      "MAXCOUNT",
      "3",
      "MAXSIZE",
      "100",
      "STREAMS",
      "a",
      "b",
      "0",
      "+",
    ],
    reply: { _tag: "Map", entries: [[blob("b"), array(array(blob("1-0"), payload))]] },
    expected: Option.some([
      { key: bytes("b"), entries: [{ id: "1-0", fields: [[bytes("f"), bytes("v")]] }] },
    ]),
    keys: [8, 9],
  },
  {
    label: "XREADGROUP tombstone",
    command: Commands.xreadgroup("g", "c", [["s", "0"]]),
    tokens: ["XREADGROUP", "GROUP", "g", "c", "STREAMS", "s", "0"],
    reply: array(array(blob("s"), array(array(blob("1-0"), missing)))),
    expected: Option.some([{ key: bytes("s"), entries: [{ id: "1-0", fields: Option.none() }] }]),
    keys: [5],
  },
  {
    label: "XREADGROUP CLAIM",
    command: Commands.xreadgroupClaim("g", "c", [["s", ">"]], 0, { noAck: true }),
    tokens: ["XREADGROUP", "GROUP", "g", "c", "CLAIM", "0", "NOACK", "STREAMS", "s", ">"],
    reply: array(array(blob("s"), array(array(blob("1-0"), payload, integer(5n), integer(2n))))),
    expected: Option.some([
      {
        key: bytes("s"),
        entries: [
          {
            id: "1-0",
            fields: Option.some([[bytes("f"), bytes("v")]]),
            idleMillis: 5n,
            deliveries: 2n,
          },
        ],
      },
    ]),
    keys: [8],
  },
]);

it.effect(
  "STREAM-BLOCK: millisecond waits select blocking ownership and preserve timeout absence",
  () =>
    Effect.gen(function* () {
      const prepared = yield* Commands.xread([["s", "$"]], {
        block: { blockFor: Duration.millis(25) },
      }).prepare;
      expect(prepared.tokens).toEqual(["XREAD", "BLOCK", "25", "STREAMS", "s", "$"]);
      expect(prepared.metadata.execution).toBe("blocking");
      expect(prepared.replyTimeoutMillis).toBe(1025);
      expect(yield* prepared.decode({ _tag: "Null", kind: "array" })).toEqual(Option.none());
    }),
);

it.effect(
  "STREAM-READ: CLAIM decoding binds to prepared flags and validates aggregate budgets",
  () =>
    Effect.gen(function* () {
      const options = { count: 2, maxCount: 1 };
      expect(yield* Effect.flip(Commands.xread([["s", "0"]], options).prepare)).toMatchObject({
        _tag: "CommandInputError",
      });
      const prepared = yield* Commands.xreadgroupClaim("g", "c", [["s", ">"]], 0).prepare;
      const wrongShape = array(array(blob("s"), array(array(blob("1-0"), payload))));
      expect(yield* Effect.flip(prepared.decode(wrongShape))).toMatchObject({
        _tag: "ReplyError",
        path: [0, 1, 0],
      });
    }),
);
