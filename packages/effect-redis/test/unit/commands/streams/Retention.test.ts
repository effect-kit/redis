import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Commands } from "#/index";
import { array, commandCases, integer } from "#test/support/commands/CoreCase";

commandCases("STREAM-RETENTION", [
  {
    label: "XACK",
    command: Commands.xack("s", "g", ["1-0"]),
    tokens: ["XACK", "s", "g", "1-0"],
    reply: integer(1n),
    expected: 1n,
    keys: [1],
  },
  {
    label: "XDEL",
    command: Commands.xdel("s", ["1-0"]),
    tokens: ["XDEL", "s", "1-0"],
    reply: integer(1n),
    expected: 1n,
    keys: [1],
  },
  {
    label: "XTRIM",
    command: Commands.xtrim(
      "s",
      { by: "MINID", threshold: "1-0", approximate: true, limit: 0 },
      "ACKED",
    ),
    tokens: ["XTRIM", "s", "MINID", "~", "1-0", "LIMIT", "0", "ACKED"],
    reply: integer(1n),
    expected: 1n,
    keys: [1],
  },
  {
    label: "XACKDEL",
    command: Commands.xackdel("s", "g", ["1-0", "2-0"], "DELREF"),
    tokens: ["XACKDEL", "s", "g", "DELREF", "IDS", "2", "1-0", "2-0"],
    reply: array(integer(1n), integer(-1n)),
    expected: [1n, -1n],
    keys: [1],
  },
  {
    label: "XDELEX",
    command: Commands.xdelex("s", ["1-0"], "KEEPREF"),
    tokens: ["XDELEX", "s", "KEEPREF", "IDS", "1", "1-0"],
    reply: array(integer(2n)),
    expected: [2n],
    keys: [1],
  },
  {
    label: "XNACK",
    command: Commands.xnack("s", "g", "FAIL", ["1-0"], { retryCount: 3, force: true }),
    tokens: ["XNACK", "s", "g", "FAIL", "IDS", "1", "1-0", "RETRYCOUNT", "3", "FORCE"],
    reply: integer(1n),
    expected: 1n,
    keys: [1],
  },
]);

it.effect("STREAM-RETENTION: positional results bind to prepared IDs", () =>
  Effect.gen(function* () {
    const ids: ["1-0" | "2-0", ...Array<"1-0" | "2-0">] = ["1-0"];
    const prepared = yield* Commands.xdelex("s", ids).prepare;
    ids.push("2-0");
    expect(yield* prepared.decode(array(integer(1n)))).toEqual([1n]);
    expect(yield* Effect.flip(prepared.decode(array(integer(0n))))).toMatchObject({
      _tag: "ReplyError",
    });
    expect(yield* Effect.flip(prepared.decode(array()))).toMatchObject({
      expected: "array-length",
    });
  }),
);
