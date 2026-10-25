import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";

import { makeExecutor, makeRedis } from "#/index";
import { bytes, controlled, sent } from "#test/support/connection/Controlled";

it.effect("SCAN-LAZY: empty continuation pages and duplicates survive lazy iteration", () =>
  Effect.gen(function* () {
    const { connection, fixture } = yield* controlled();
    const redis = makeRedis(makeExecutor(connection));
    const stream = redis.scanKeys();
    expect(yield* fixture.written).toEqual([]);

    const request = yield* Effect.forkChild(Stream.runCollect(stream));
    yield* sent(fixture, ["SCAN", "0"], "*2\r\n$1\r\n9\r\n*0\r\n");
    yield* sent(fixture, ["SCAN", "9"], "*2\r\n$1\r\n8\r\n*1\r\n$1\r\na\r\n");
    yield* sent(fixture, ["SCAN", "8"], "*2\r\n$1\r\n0\r\n*1\r\n$1\r\na\r\n");
    expect(yield* Fiber.join(request)).toEqual([bytes("a"), bytes("a")]);
  }),
);

it.effect("SCAN-TAKE: downstream termination does not request another page", () =>
  Effect.gen(function* () {
    const { connection, fixture } = yield* controlled();
    const redis = makeRedis(makeExecutor(connection));
    const request = yield* Effect.forkChild(
      Stream.runCollect(redis.scanSet("s").pipe(Stream.take(1))),
    );
    yield* sent(fixture, ["SSCAN", "s", "0"], "*2\r\n$1\r\n9\r\n*2\r\n$1\r\na\r\n$1\r\nb\r\n");
    expect(yield* Fiber.join(request)).toEqual([bytes("a")]);
    expect(yield* fixture.written).toHaveLength(1);
  }),
);

it.effect(
  "SCAN-ARRAY: reverse pagination advances by exact index rather than inventing cursors",
  () =>
    Effect.gen(function* () {
      const { connection, fixture } = yield* controlled();
      const redis = makeRedis(makeExecutor(connection));
      const request = yield* Effect.forkChild(
        Stream.runCollect(redis.scanArray("a", 9, 1, { limit: 1 })),
      );
      yield* sent(
        fixture,
        ["ARSCAN", "a", "9", "1", "LIMIT", "1"],
        "*1\r\n*2\r\n:8\r\n$1\r\nv\r\n",
      );
      yield* sent(
        fixture,
        ["ARSCAN", "a", "7", "1", "LIMIT", "1"],
        "*1\r\n*2\r\n:1\r\n$1\r\nw\r\n",
      );
      expect(yield* Fiber.join(request)).toEqual([
        [8n, bytes("v")],
        [1n, bytes("w")],
      ]);
    }),
);
