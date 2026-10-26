import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Commands } from "#/index";
import { array, blob, bytes, integer, missing } from "#test/support/commands/CoreCase";

const statistics = [
  blob("length"),
  integer(0n),
  blob("radix-tree-keys"),
  integer(0n),
  blob("radix-tree-nodes"),
  integer(1n),
  blob("last-generated-id"),
  blob("9007199254740993-0"),
];

it.effect(
  "STREAM-INFO: summary preserves empty entries, unknown fields and optional version statistics",
  () =>
    Effect.gen(function* () {
      const prepared = yield* Commands.xinfoStream("s").prepare;
      expect(prepared.tokens).toEqual(["XINFO", "STREAM", "s"]);
      const reply = array(
        ...statistics,
        blob("groups"),
        integer(0n),
        blob("first-entry"),
        missing,
        blob("last-entry"),
        missing,
        blob("future-field"),
        blob("binary-value"),
      );
      const result = yield* prepared.decode(reply);
      expect(result).toMatchObject({
        length: 0n,
        groups: 0n,
        lastGeneratedId: "9007199254740993-0",
        firstEntry: Option.none(),
        lastEntry: Option.none(),
        entriesAdded: Option.none(),
      });
      expect(result.attributes.at(-1)).toEqual(["future-field", blob("binary-value")]);
    }),
);

it.effect("STREAM-INFO: FULL groups preserve unowned pending entries and consumer timing", () =>
  Effect.gen(function* () {
    const prepared = yield* Commands.xinfoStreamFull("s", 0).prepare;
    expect(prepared.tokens).toEqual(["XINFO", "STREAM", "s", "FULL", "COUNT", "0"]);
    const group = array(
      blob("name"),
      blob("g"),
      blob("last-delivered-id"),
      blob("1-0"),
      blob("pel-count"),
      integer(1n),
      blob("pending"),
      array(array(blob("1-0"), missing, integer(9007199254740993n), integer(2n))),
      blob("consumers"),
      array(),
      blob("nacked-count"),
      integer(1n),
    );
    const result = yield* prepared.decode(
      array(...statistics, blob("entries"), array(), blob("groups"), array(group)),
    );
    expect(result.groups[0]).toMatchObject({
      name: bytes("g"),
      pendingCount: 1n,
      nackedCount: Option.some(1n),
      pending: [
        {
          id: "1-0",
          consumer: Option.none(),
          deliveryTimeMillis: 9007199254740993n,
          deliveries: 2n,
        },
      ],
    });
  }),
);

it.effect(
  "STREAM-INFO: group/consumer variants decode typed fields and retain malformed paths",
  () =>
    Effect.gen(function* () {
      const groups = yield* Commands.xinfoGroups("s").prepare;
      expect(groups.tokens).toEqual(["XINFO", "GROUPS", "s"]);
      const group = array(
        blob("name"),
        blob("g"),
        blob("consumers"),
        integer(1n),
        blob("pending"),
        integer(2n),
        blob("last-delivered-id"),
        blob("1-0"),
        blob("entries-read"),
        missing,
        blob("lag"),
        integer(5n),
      );
      expect(yield* groups.decode(array(group))).toMatchObject([
        { name: bytes("g"), pending: 2n, entriesRead: Option.none(), lag: Option.some(5n) },
      ]);
      const consumers = yield* Commands.xinfoConsumers("s", "g").prepare;
      expect(consumers.tokens).toEqual(["XINFO", "CONSUMERS", "s", "g"]);
      const consumer = array(
        blob("name"),
        blob("c"),
        blob("pending"),
        integer(1n),
        blob("idle"),
        integer(2n),
      );
      expect(yield* consumers.decode(array(consumer))).toEqual([
        { name: bytes("c"), pending: 1n, idleMillis: 2n, inactiveMillis: Option.none() },
      ]);
      expect(yield* Effect.flip(groups.decode(array(array())))).toMatchObject({
        _tag: "ReplyError",
        path: [0],
      });
      const help = yield* Commands.xinfoHelp().prepare;
      expect(help.tokens).toEqual(["XINFO", "HELP"]);
      expect(yield* help.decode(array(blob("help")))).toEqual(["help"]);
    }),
);
