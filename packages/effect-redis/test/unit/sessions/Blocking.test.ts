import { expect, it } from "@effect/vitest";
import { Duration, Effect, Option } from "effect";

import { Commands } from "#/index";
import type { Command } from "#/index";
import { array, blob, bytes, missing } from "#test/support/commands/CoreCase";

const options = { blockFor: Duration.millis(25) };
const cases = [
  {
    name: "BLPOP",
    command: Commands.blpop(["a", "b"], options),
    tokens: ["BLPOP", "a", "b", "0.025"],
    keys: [1, 2],
    reply: array(blob("b"), blob("v")),
    expected: Option.some([bytes("b"), bytes("v")]),
  },
  {
    name: "BRPOP",
    command: Commands.brpop(["a"], options),
    tokens: ["BRPOP", "a", "0.025"],
    keys: [1],
    reply: array(blob("a"), blob("v")),
    expected: Option.some([bytes("a"), bytes("v")]),
  },
  {
    name: "BRPOPLPUSH",
    command: Commands.brpoplpush("a", "b", options),
    tokens: ["BRPOPLPUSH", "a", "b", "0.025"],
    keys: [1, 2],
    reply: blob("v"),
    expected: Option.some(bytes("v")),
  },
  {
    name: "BLMOVE",
    command: Commands.blmove("a", "b", "LEFT", "RIGHT", options),
    tokens: ["BLMOVE", "a", "b", "LEFT", "RIGHT", "0.025"],
    keys: [1, 2],
    reply: missing,
    expected: Option.none(),
  },
  {
    name: "BLMPOP",
    command: Commands.blmpop(["a", "b"], "RIGHT", options, 2),
    tokens: ["BLMPOP", "0.025", "2", "a", "b", "RIGHT", "COUNT", "2"],
    keys: [3, 4],
    reply: array(blob("b"), array(blob("v"))),
    expected: Option.some([bytes("b"), [bytes("v")]]),
  },
  {
    name: "BLMOVEM",
    command: Commands.blmovem("a", "b", "RIGHT", "LEFT", options, {
      selection: "EXACTLY",
      count: 2,
      ordering: "BULK",
    }),
    tokens: ["BLMOVEM", "a", "b", "RIGHT", "LEFT", "0.025", "EXACTLY", "2", "BULK"],
    keys: [1, 2],
    reply: array(blob("v")),
    expected: Option.some([bytes("v")]),
  },
  {
    name: "BZPOPMIN",
    command: Commands.bzpopmin(["a"], options),
    tokens: ["BZPOPMIN", "a", "0.025"],
    keys: [1],
    reply: array(blob("a"), blob("m"), blob("inf")),
    expected: Option.some([bytes("a"), bytes("m"), "inf"]),
  },
  {
    name: "BZPOPMAX",
    command: Commands.bzpopmax(["a"], options),
    tokens: ["BZPOPMAX", "a", "0.025"],
    keys: [1],
    reply: array(blob("a"), blob("m"), { _tag: "Double" as const, value: "1.5" }),
    expected: Option.some([bytes("a"), bytes("m"), "1.5"]),
  },
  {
    name: "BZMPOP",
    command: Commands.bzmpop(["a", "b"], "MAX", options, 2),
    tokens: ["BZMPOP", "0.025", "2", "a", "b", "MAX", "COUNT", "2"],
    keys: [3, 4],
    reply: array(blob("a"), array(array(blob("m"), blob("1")))),
    expected: Option.some([bytes("a"), [[bytes("m"), "1"]]]),
  },
];

it.effect.each(cases)(
  "BLOCK-ENCODE: $name encodes units, keys and its exact reply shape",
  ({ command, tokens, keys, reply, expected }) =>
    Effect.gen(function* () {
      const prepared = yield* (command as Command<unknown>).prepare;
      expect(prepared.tokens).toEqual(tokens);
      expect(prepared.metadata).toMatchObject({ execution: "blocking", replay: "never" });
      expect(prepared.replyTimeoutMillis).toBe(1025);
      expect(
        prepared.routing._tag === "Keys" ? prepared.routing.keys.map((key) => key.index) : [],
      ).toEqual(keys);
      expect(yield* prepared.decode(reply)).toEqual(expected);
      expect(yield* prepared.decode({ _tag: "Null", kind: "resp3" })).toEqual(Option.none());
    }),
);

const invalid: ReadonlyArray<Command<unknown>> = [
  Commands.blpop(["k"], { blockFor: Duration.zero }),
  Commands.blpop(["k"], { blockFor: Duration.infinity }),
  Commands.blpop(["k"], { blockFor: Duration.seconds(1), timeout: Duration.zero }),
  Commands.blmpop(["k"], "LEFT", options, 0),
  Commands.bzmpop(["k"], "MIN", options, -1),
  Commands.blmovem("a", "b", "LEFT", "RIGHT", options, {
    selection: "EXACTLY",
    count: 0,
    ordering: "OBO",
  }),
];
it.effect.each(invalid)(
  "BLOCK-INPUT: invalid wait/count fails before wire admission %#",
  (command) =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(command.prepare)).toMatchObject({
        _tag: "CommandInputError",
        delivery: "unsent",
      });
    }),
);

it.effect(
  "BLOCK-TIME: explicit forever and fractional seconds retain independent client deadlines",
  () =>
    Effect.gen(function* () {
      const forever = yield* Commands.blpop(["k"], {
        blockFor: "forever",
        timeout: Duration.millis(5),
      }).prepare;
      expect(forever.tokens).toEqual(["BLPOP", "k", "0"]);
      expect(forever.replyTimeoutMillis).toBe(5);
      const nanos = yield* Commands.blpop(["k"], { blockFor: Duration.nanos(1n) }).prepare;
      expect(nanos.tokens).toEqual(["BLPOP", "k", "0.000000001"]);
    }),
);
