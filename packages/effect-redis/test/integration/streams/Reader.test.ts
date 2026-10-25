import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";

import { bytes, sent } from "#test/support/connection/Controlled";
import { groupReply, streamFixture } from "#test/support/streams/Fixture";

it.effect("STREAM-READER: resolves $ once and retains its concrete cursor through timeouts", () =>
  Effect.gen(function* () {
    const { streams, blocking, sessions } = yield* streamFixture();
    const request = yield* Effect.forkChild(
      Stream.runCollect(streams.read([["s", "$"]]).pipe(Stream.take(1))),
    );
    yield* sent(
      blocking,
      ["XREVRANGE", "s", "+", "-", "COUNT", "1"],
      "*1\r\n*2\r\n$3\r\n1-0\r\n*2\r\n$1\r\nf\r\n$1\r\nv\r\n",
    );
    yield* sent(
      blocking,
      ["XREAD", "COUNT", "64", "BLOCK", "5000", "STREAMS", "s", "1-0"],
      "*-1\r\n",
    );
    yield* sent(
      blocking,
      ["XREAD", "COUNT", "64", "BLOCK", "5000", "STREAMS", "s", "1-0"],
      groupReply("2-0"),
    );
    expect(yield* Fiber.join(request)).toMatchObject([
      { stream: bytes("s"), entry: { id: "2-0" } },
    ]);
    expect(yield* sessions.snapshot).toMatchObject({ leased: 0, waiting: 0 });
    expect(yield* blocking.observations).toMatchObject({ closed: 1 });
  }),
);

it.effect(
  "STREAM-READER: cancellation retires a blocking read and preserves ordinary progress",
  () =>
    Effect.gen(function* () {
      const { streams, ordinary, blocking, redis } = yield* streamFixture();
      const request = yield* Effect.forkChild(Stream.runDrain(streams.readGroup("g", "c", ["s"])));
      yield* sent(blocking, [
        "XREADGROUP",
        "GROUP",
        "g",
        "c",
        "COUNT",
        "64",
        "BLOCK",
        "5000",
        "STREAMS",
        "s",
        ">",
      ]);
      yield* Fiber.interrupt(request);
      expect(yield* blocking.observations).toMatchObject({ closed: 1 });
      const ping = yield* Effect.forkChild(redis.ping());
      // The original ordinary connection remains independent of the canceled reader.
      yield* sent(ordinary, ["PING"], "+PONG\r\n");
      yield* Fiber.join(ping);
      expect(yield* ordinary.observations).toMatchObject({ closed: 0 });
    }),
);

it.effect("STREAM-READER: nonadvancing IDs fail explicitly", () =>
  Effect.gen(function* () {
    const { streams, blocking } = yield* streamFixture();
    const request = yield* Effect.forkChild(
      Effect.flip(Stream.runDrain(streams.read([["s", "1-0"]]))),
    );
    yield* sent(
      blocking,
      ["XREAD", "COUNT", "64", "BLOCK", "5000", "STREAMS", "s", "1-0"],
      groupReply("1-0"),
    );
    expect(yield* Fiber.join(request)).toMatchObject({
      _tag: "StreamConsumerError",
      reason: "invalid-response",
    });
  }),
);

it.effect(
  "STREAM-RECOVERY: pending pages stop on empty results without moving to new deliveries",
  () =>
    Effect.gen(function* () {
      const { streams, ordinary, opens } = yield* streamFixture();
      const request = yield* Effect.forkChild(
        Stream.runCollect(streams.pending("s", "g", "c", { count: 1 })),
      );
      yield* sent(
        ordinary,
        ["XREADGROUP", "GROUP", "g", "c", "COUNT", "1", "STREAMS", "s", "0-0"],
        groupReply("1-0"),
      );
      yield* sent(
        ordinary,
        ["XREADGROUP", "GROUP", "g", "c", "COUNT", "1", "STREAMS", "s", "1-0"],
        "*1\r\n*2\r\n$1\r\ns\r\n*0\r\n",
      );
      expect(yield* Fiber.join(request)).toMatchObject([{ entry: { id: "1-0" } }]);
      expect(opens()).toBe(1);
    }),
);

it.effect("STREAM-RECOVERY: empty nonterminal claim pages retain deletion evidence", () =>
  Effect.gen(function* () {
    const { streams, ordinary } = yield* streamFixture();
    const request = yield* Effect.forkChild(Stream.runCollect(streams.claim("s", "g", "c", 10)));
    yield* sent(
      ordinary,
      ["XAUTOCLAIM", "s", "g", "c", "10", "0-0", "COUNT", "64"],
      "*3\r\n$3\r\n1-0\r\n*0\r\n*1\r\n$3\r\n2-0\r\n",
    );
    yield* sent(
      ordinary,
      ["XAUTOCLAIM", "s", "g", "c", "10", "1-0", "COUNT", "64"],
      "*3\r\n$3\r\n0-0\r\n*0\r\n*0\r\n",
    );
    const pages = yield* Fiber.join(request);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ cursor: "1-0", entries: [] });
  }),
);

it.effect("STREAM-READER: a cumulative budget smaller than the default count remains valid", () =>
  Effect.gen(function* () {
    const { streams, blocking } = yield* streamFixture();
    const request = yield* Effect.forkChild(
      Stream.runCollect(streams.read([["s", "0"]], { maxCount: 1 }).pipe(Stream.take(1))),
    );
    yield* sent(
      blocking,
      ["XREAD", "COUNT", "1", "MAXCOUNT", "1", "BLOCK", "5000", "STREAMS", "s", "0"],
      groupReply(),
    );
    expect(yield* Fiber.join(request)).toHaveLength(1);
  }),
);

it.effect(
  "STREAM-READER: construction and zero consumption do not open a dedicated connection",
  () =>
    Effect.gen(function* () {
      const { streams, opens } = yield* streamFixture();
      const reader = streams.read([["s", "$"]]);
      expect(opens()).toBe(1);
      yield* Stream.runDrain(reader.pipe(Stream.take(0)));
      expect(opens()).toBe(1);
    }),
);

it.effect(
  "STREAM-RECOVERY: malformed nonadvancing pending and claim cursors fail rather than loop",
  () =>
    Effect.gen(function* () {
      const { streams, ordinary } = yield* streamFixture();
      const pending = yield* Effect.forkChild(
        Effect.flip(Stream.runDrain(streams.pending("s", "g", "c"))),
      );
      yield* sent(
        ordinary,
        ["XREADGROUP", "GROUP", "g", "c", "COUNT", "64", "STREAMS", "s", "0-0"],
        groupReply(),
      );
      yield* sent(
        ordinary,
        ["XREADGROUP", "GROUP", "g", "c", "COUNT", "64", "STREAMS", "s", "1-0"],
        groupReply(),
      );
      expect(yield* Fiber.join(pending)).toMatchObject({ reason: "invalid-response" });
      const claim = yield* Effect.forkChild(
        Effect.flip(Stream.runDrain(streams.claim("s", "g", "c", 0))),
      );
      yield* sent(
        ordinary,
        ["XAUTOCLAIM", "s", "g", "c", "0", "0-0", "COUNT", "64"],
        "*2\r\n$3\r\n1-0\r\n*0\r\n",
      );
      yield* sent(
        ordinary,
        ["XAUTOCLAIM", "s", "g", "c", "0", "1-0", "COUNT", "64"],
        "*2\r\n$3\r\n1-0\r\n*0\r\n",
      );
      expect(yield* Fiber.join(claim)).toMatchObject({ reason: "invalid-response" });
    }),
);
