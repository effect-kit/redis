import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Commands } from "#/index";
import { array, blob, bytes, commandCases, integer } from "#test/support/commands/CoreCase";

commandCases("SCAN", [
  {
    label: "SCAN filters",
    command: Commands.scan("18446744073709551615", { match: "a*", count: 2, type: "string" }),
    tokens: ["SCAN", "18446744073709551615", "MATCH", "a*", "COUNT", "2", "TYPE", "string"],
    reply: array(blob("7"), array(blob("a"))),
    expected: { cursor: "7", entries: [bytes("a")] },
    keys: [],
  },
  {
    label: "HSCAN pairs",
    command: Commands.hscan("h"),
    tokens: ["HSCAN", "h", "0"],
    reply: array(blob("0"), array(blob("f"), blob("v"), blob("f"), blob("w"))),
    expected: {
      cursor: "0",
      entries: [
        [bytes("f"), bytes("v")],
        [bytes("f"), bytes("w")],
      ],
    },
    keys: [1],
  },
  {
    label: "HSCAN fields",
    command: Commands.hscanFields("h"),
    tokens: ["HSCAN", "h", "0", "NOVALUES"],
    reply: array(blob("0"), array(blob("f"))),
    expected: { cursor: "0", entries: [bytes("f")] },
    keys: [1],
  },
  {
    label: "SSCAN empty continuation",
    command: Commands.sscan("s", "9"),
    tokens: ["SSCAN", "s", "9"],
    reply: array(blob("8"), array()),
    expected: { cursor: "8", entries: [] },
    keys: [1],
  },
  {
    label: "ZSCAN scores",
    command: Commands.zscan("z"),
    tokens: ["ZSCAN", "z", "0"],
    reply: array(blob("0"), array(blob("m"), blob("inf"))),
    expected: { cursor: "0", entries: [[bytes("m"), "inf"]] },
    keys: [1],
  },
  {
    label: "ZSCAN members",
    command: Commands.zscanMembers("z"),
    tokens: ["ZSCAN", "z", "0", "NOSCORES"],
    reply: array(blob("0"), array(blob("m"))),
    expected: { cursor: "0", entries: [bytes("m")] },
    keys: [1],
  },
  {
    label: "ARSCAN reverse uint64",
    command: Commands.arscan("a", 18446744073709551615n, 0, { limit: 1 }),
    tokens: ["ARSCAN", "a", "18446744073709551615", "0", "LIMIT", "1"],
    reply: array(array(blob("18446744073709551615"), blob("v"))),
    expected: [[18446744073709551615n, bytes("v")]],
    keys: [1],
  },
]);

it.effect.each(["-1", "1.5", "18446744073709551616", "invalid", "01"])(
  "SCAN-INPUT: rejects invalid cursor %s",
  (cursor) =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(Commands.scan(cursor).prepare)).toMatchObject({
        _tag: "CommandInputError",
      });
    }),
);

it.effect("SCAN-REPLY: malformed cursor, odd pairs and invalid range results are rejected", () =>
  Effect.gen(function* () {
    const scan = yield* Commands.scan().prepare;
    expect(yield* Effect.flip(scan.decode(array(blob("bad"), array())))).toMatchObject({
      _tag: "ReplyError",
    });
    const hash = yield* Commands.hscan("h").prepare;
    expect(yield* Effect.flip(hash.decode(array(blob("0"), array(blob("f")))))).toMatchObject({
      _tag: "ReplyError",
    });
    const range = yield* Commands.arscan("a", 1, 3).prepare;
    for (const positions of [[0n], [2n, 2n], [3n, 2n]]) {
      expect(
        yield* Effect.flip(
          range.decode(array(...positions.map((n) => array(integer(n), blob("v"))))),
        ),
      ).toMatchObject({ _tag: "ReplyError" });
    }
  }),
);
