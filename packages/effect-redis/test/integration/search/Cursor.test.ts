import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";

import { makeRedisSearch } from "#/index";
import { bytes, sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

const create = [
  "FT.AGGREGATE",
  "idx",
  "hello",
  "WITHCURSOR",
  "COUNT",
  "64",
  "MAXIDLE",
  "60000",
] as const;
const emptyPage = (cursor: number) => `*2\r\n*1\r\n:0\r\n:${cursor}\r\n`;

it.effect(
  "SEARCH-CURSOR: early exit deletes the owned server cursor before releasing its lease",
  () =>
    Effect.gen(function* () {
      const { sessions, primary, opens } = yield* sessionFixture();
      const rows = makeRedisSearch(sessions).aggregate("idx", "hello");
      expect(opens()).toBe(0);
      const request = yield* rows.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
      yield* sent(
        primary,
        create,
        "*2\r\n*4\r\n:3\r\n*2\r\n$1\r\nf\r\n$1\r\na\r\n*2\r\n$1\r\nf\r\n$1\r\nb\r\n*2\r\n$1\r\nf\r\n$1\r\nc\r\n:17\r\n",
      );
      yield* sent(primary, ["FT.CURSOR", "DEL", "idx", "17"], "+OK\r\n");

      expect((yield* Fiber.join(request)).length).toBe(1);
      expect(yield* sessions.snapshot).toMatchObject({ leased: 0, waiting: 0 });
      expect((yield* primary.written).length).toBe(2);
    }),
);

it.effect("SEARCH-CURSOR: cancellation waits for the current receipt then deletes its new ID", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const request = yield* makeRedisSearch(sessions)
      .aggregate("idx", "hello")
      .pipe(Stream.runDrain, Effect.forkChild);
    yield* sent(primary, create, emptyPage(17));
    yield* sent(primary, ["FT.CURSOR", "READ", "idx", "17", "COUNT", "64"]);
    const interruption = yield* Fiber.interrupt(request).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* primary.receive(bytes(emptyPage(18)));
    yield* sent(primary, ["FT.CURSOR", "DEL", "idx", "18"], "+OK\r\n");

    yield* Fiber.join(interruption);
    expect(yield* sessions.snapshot).toMatchObject({ leased: 0, waiting: 0 });
    expect((yield* primary.written).length).toBe(3);
  }),
);

it.effect(
  "SEARCH-CURSOR: malformed creation receipts fail without replay or fabricated cursor IDs",
  () =>
    Effect.gen(function* () {
      const { sessions, primary, opens } = yield* sessionFixture();
      const request = yield* makeRedisSearch(sessions)
        .aggregate("idx", "hello")
        .pipe(Stream.runDrain, Effect.flip, Effect.forkChild);
      yield* sent(primary, create, "*2\r\n*1\r\n:0\r\n$4\r\noops\r\n");

      expect(yield* Fiber.join(request)).toMatchObject({ _tag: "ReplyError" });
      expect(opens()).toBe(1);
      expect((yield* primary.written).length).toBe(1);
    }),
);

it.effect("SEARCH-CURSOR: cleanup rejection escapes early consumer exit", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const request = yield* makeRedisSearch(sessions)
      .aggregate("idx", "hello")
      .pipe(Stream.take(1), Stream.runDrain, Effect.exit, Effect.forkChild);
    yield* sent(
      primary,
      create,
      "*2\r\n*4\r\n:3\r\n*2\r\n$1\r\nf\r\n$1\r\na\r\n*2\r\n$1\r\nf\r\n$1\r\nb\r\n*2\r\n$1\r\nf\r\n$1\r\nc\r\n:17\r\n",
    );
    yield* sent(primary, ["FT.CURSOR", "DEL", "idx", "17"], "-ERR cleanup-rejected\r\n");
    const exit = yield* Fiber.join(request);
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  }),
);

it.effect("SEARCH-CURSOR: a lost page receipt reaches the native deadline without replay", () =>
  Effect.gen(function* () {
    const { sessions, primary, opens } = yield* sessionFixture({}, { commandTimeoutMillis: 20 });
    const request = yield* makeRedisSearch(sessions)
      .aggregate("idx", "hello")
      .pipe(Stream.runDrain, Effect.exit, Effect.forkChild);
    yield* sent(primary, create, emptyPage(17));
    yield* sent(primary, ["FT.CURSOR", "READ", "idx", "17", "COUNT", "64"]);
    yield* TestClock.adjust(25);
    expect(Exit.isFailure(yield* Fiber.join(request))).toBe(true);
    expect(opens()).toBe(1);
    expect((yield* primary.written).length).toBe(2);
  }),
);
