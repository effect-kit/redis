import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Commands } from "#/index";
import { array, blob, commandCases, integer, ok } from "#test/support/commands/CoreCase";

it.effect("PUBSUB: subscriber count lengths bind to prepared channel snapshots", () =>
  Effect.gen(function* () {
    const channels = ["a", "b"];
    const prepared = yield* Commands.pubsubNumSub(channels).prepare;
    channels.push("later");

    expect(
      yield* prepared.decode(array(blob("a"), integer(1n), blob("b"), integer(0n))),
    ).toHaveLength(2);
    expect(yield* Effect.flip(prepared.decode(array(blob("a"), integer(1n))))).toMatchObject({
      _tag: "ReplyError",
      expected: "array-length",
    });
  }),
);

commandCases("PUBSUB", [
  {
    label: "PUBLISH",
    command: Commands.publish("c", new Uint8Array([0, 255])),
    tokens: ["PUBLISH", "c", new Uint8Array([0, 255])],
    reply: integer(2n),
    expected: 2n,
    keys: [],
  },
  {
    label: "SPUBLISH",
    command: Commands.spublish("c", "v"),
    tokens: ["SPUBLISH", "c", "v"],
    reply: integer(0n),
    expected: 0n,
    keys: [],
  },
  {
    label: "CHANNELS",
    command: Commands.pubsubChannels("c*"),
    tokens: ["PUBSUB", "CHANNELS", "c*"],
    reply: array(blob("c")),
    expected: [new TextEncoder().encode("c")],
    keys: [],
  },
  {
    label: "SHARDCHANNELS",
    command: Commands.pubsubShardChannels(),
    tokens: ["PUBSUB", "SHARDCHANNELS"],
    reply: array(),
    expected: [],
    keys: [],
  },
  {
    label: "NUMSUB",
    command: Commands.pubsubNumSub(["c"]),
    tokens: ["PUBSUB", "NUMSUB", "c"],
    reply: array(blob("c"), integer(3n)),
    expected: [[new TextEncoder().encode("c"), 3n]],
    keys: [],
  },
  {
    label: "SHARDNUMSUB",
    command: Commands.pubsubShardNumSub(),
    tokens: ["PUBSUB", "SHARDNUMSUB"],
    reply: array(),
    expected: [],
    keys: [],
  },
  {
    label: "NUMPAT",
    command: Commands.pubsubNumPat(),
    tokens: ["PUBSUB", "NUMPAT"],
    reply: integer(1n),
    expected: 1n,
    keys: [],
  },
  {
    label: "HELP",
    command: Commands.pubsubHelp(),
    tokens: ["PUBSUB", "HELP"],
    reply: array({ _tag: "SimpleString", value: new TextEncoder().encode("help") }),
    expected: ["help"],
    keys: [],
  },
]);

it.effect("TRACK: options encode one exclusive connection control", () =>
  Effect.gen(function* () {
    const prepared = yield* Commands.clientTracking(true, {
      mode: "broadcast",
      prefixes: [new Uint8Array([255])],
      redirect: 9007199254740993n,
      noLoop: true,
    }).prepare;

    expect(prepared.tokens).toEqual([
      "CLIENT",
      "TRACKING",
      "ON",
      "REDIRECT",
      "9007199254740993",
      "BCAST",
      "PREFIX",
      new Uint8Array([255]),
      "NOLOOP",
    ]);
    expect(prepared.metadata.execution).toBe("exclusive");
    expect(yield* prepared.decode(ok)).toBeUndefined();
    expect(
      yield* Effect.flip(Commands.clientTracking(false, { mode: "optin" }).prepare),
    ).toMatchObject({ _tag: "CommandInputError" });
  }),
);

it.effect("TRACK: information preserves signed redirect sentinels and future fields", () =>
  Effect.gen(function* () {
    const prepared = yield* Commands.clientTrackingInfo().prepare;
    const result = yield* prepared.decode(
      array(
        blob("flags"),
        array(blob("off")),
        blob("redirect"),
        integer(-1n),
        blob("prefixes"),
        array(),
        blob("future"),
        integer(9n),
      ),
    );

    expect(result).toMatchObject({ flags: ["off"], redirect: -1n, prefixes: [] });
    expect(result.attributes.at(-1)).toEqual(["future", integer(9n)]);
    expect(yield* Effect.flip(prepared.decode(array()))).toMatchObject({ _tag: "ReplyError" });
  }),
);
