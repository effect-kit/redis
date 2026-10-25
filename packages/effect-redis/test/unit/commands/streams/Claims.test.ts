import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Commands } from "#/index";
import { array, blob, bytes, commandCases } from "#test/support/commands/CoreCase";

const entry = array(blob("1-0"), array(blob("f"), blob("v")));
const expected = { id: "1-0", fields: Option.some([[bytes("f"), bytes("v")]]) };

commandCases("STREAM-CLAIM", [
  {
    label: "XCLAIM options",
    command: Commands.xclaim("s", "g", "c", 10, ["1-0"], {
      deliveryTime: { type: "TIME", millis: 12 },
      retryCount: 2,
      force: true,
      lastId: "2-0",
    }),
    tokens: [
      "XCLAIM",
      "s",
      "g",
      "c",
      "10",
      "1-0",
      "TIME",
      "12",
      "RETRYCOUNT",
      "2",
      "FORCE",
      "LASTID",
      "2-0",
    ],
    reply: array(entry),
    expected: [Option.some(expected)],
    keys: [1],
  },
  {
    label: "XCLAIM IDs",
    command: Commands.xclaimIds("s", "g", "c", 0, ["1-0"]),
    tokens: ["XCLAIM", "s", "g", "c", "0", "1-0", "JUSTID"],
    reply: array(blob("1-0")),
    expected: ["1-0"],
    keys: [1],
  },
  {
    label: "XAUTOCLAIM",
    command: Commands.xautoclaim("s", "g", "c", 0, "0-0", { count: 2 }),
    tokens: ["XAUTOCLAIM", "s", "g", "c", "0", "0-0", "COUNT", "2"],
    reply: array(blob("0-0"), array(entry), array(blob("2-0"))),
    expected: { cursor: "0-0", entries: [Option.some(expected)], deleted: Option.some(["2-0"]) },
    keys: [1],
  },
  {
    label: "XAUTOCLAIM old IDs",
    command: Commands.xautoclaimIds("s", "g", "c", 0),
    tokens: ["XAUTOCLAIM", "s", "g", "c", "0", "0-0", "JUSTID"],
    reply: array(blob("3-0"), array(blob("1-0"))),
    expected: { cursor: "3-0", entries: ["1-0"], deleted: Option.none() },
    keys: [1],
  },
]);

it.effect("STREAM-CLAIM: malformed deleted-ID list retains its nested path", () =>
  Effect.gen(function* () {
    const prepared = yield* Commands.xautoclaim("s", "g", "c", 0).prepare;
    expect(
      yield* Effect.flip(prepared.decode(array(blob("0-0"), array(), array(blob("bad"))))),
    ).toMatchObject({ _tag: "ReplyError", path: [2, 0] });
  }),
);
