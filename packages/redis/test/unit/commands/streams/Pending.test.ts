import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Commands } from "#/index";
import {
  array,
  blob,
  bytes,
  commandCases,
  integer,
  missing,
} from "#test/support/commands/CoreCase";

commandCases("STREAM-PENDING", [
  {
    label: "empty summary",
    command: Commands.xpending("s", "g"),
    tokens: ["XPENDING", "s", "g"],
    reply: array(integer(0n), missing, missing, missing),
    expected: { count: 0n, smallest: Option.none(), largest: Option.none(), consumers: [] },
    keys: [1],
  },
  {
    label: "summary counts",
    command: Commands.xpending("s", "g"),
    tokens: ["XPENDING", "s", "g"],
    reply: array(integer(2n), blob("1-0"), blob("2-0"), array(array(blob("c"), blob("2")))),
    expected: {
      count: 2n,
      smallest: Option.some("1-0"),
      largest: Option.some("2-0"),
      consumers: [[bytes("c"), 2n]],
    },
    keys: [1],
  },
  {
    label: "detailed pending",
    command: Commands.xpendingEntries("s", "g", {
      start: "(1-0",
      end: "+",
      count: 2,
      idleMillis: 10,
      consumer: "c",
    }),
    tokens: ["XPENDING", "s", "g", "IDLE", "10", "(1-0", "+", "2", "c"],
    reply: array(array(blob("2-0"), blob("c"), integer(50n), integer(3n))),
    expected: [{ id: "2-0", consumer: bytes("c"), idleMillis: 50n, deliveries: 3n }],
    keys: [1],
  },
]);

it.effect("STREAM-PENDING: contradictory empty summary fails", () =>
  Effect.gen(function* () {
    const prepared = yield* Commands.xpending("s", "g").prepare;
    expect(
      yield* Effect.flip(prepared.decode(array(integer(0n), blob("1-0"), missing, missing))),
    ).toMatchObject({ _tag: "ReplyError" });
  }),
);
