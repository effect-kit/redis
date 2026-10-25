import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Schema } from "effect";
import { TestClock } from "effect/testing";

import { Commands, RedisKey } from "#/index";
import { bytes, sent } from "#test/support/connection/Controlled";
import { invalidation, trackingFixture } from "#test/support/subscriptions/TrackingFixture";

it.effect("CACHE: repeated GET hits own bytes while invalidations force a new remote read", () =>
  Effect.gen(function* () {
    const fixture = yield* trackingFixture();
    const cache = yield* fixture.tracking.cache();
    const first = yield* Effect.forkChild(cache.getBytes("k"));
    yield* fixture.enable;
    yield* sent(fixture.primary, ["GET", "k"], "$1\r\nv\r\n");
    const result = yield* Fiber.join(first);
    if (Option.isSome(result)) result.value[0] = 0;
    expect(yield* cache.getBytes("k")).toEqual(Option.some(bytes("v")));

    yield* fixture.primary.receive(bytes(invalidation("k")));
    while ((yield* cache.snapshot).entries !== 0) yield* Effect.yieldNow;
    const next = yield* Effect.forkChild(cache.getBytes("k"));
    yield* sent(fixture.primary, ["GET", "k"], "$1\r\nw\r\n");
    expect(yield* Fiber.join(next)).toEqual(Option.some(bytes("w")));
  }),
);

it.effect("CACHE: invalidation before a delayed GET reply prevents stale reinsertion", () =>
  Effect.gen(function* () {
    const fixture = yield* trackingFixture();
    const cache = yield* fixture.tracking.cache();
    const pending = yield* Effect.forkChild(cache.getBytes("k"));
    yield* fixture.enable;
    yield* sent(fixture.primary, ["GET", "k"]);
    yield* fixture.primary.receive(bytes(`${invalidation("k")}$3\r\nold\r\n`));

    expect(yield* Fiber.join(pending)).toEqual(Option.some(bytes("old")));
    expect(yield* cache.snapshot).toMatchObject({ entries: 0 });
    const fresh = yield* Effect.forkChild(cache.getBytes("k"));
    yield* sent(fixture.primary, ["GET", "k"], "$3\r\nnew\r\n");
    expect(yield* Fiber.join(fresh)).toEqual(Option.some(bytes("new")));
  }),
);

it.effect(
  "CACHE: flush and tracking loss clear entries even if nobody consumes observer events",
  () =>
    Effect.gen(function* () {
      const fixture = yield* trackingFixture();
      const cache = yield* fixture.tracking.cache();
      const pending = yield* Effect.forkChild(cache.getBytes("k"));
      yield* fixture.enable;
      yield* sent(fixture.primary, ["GET", "k"], "$1\r\nv\r\n");
      yield* Fiber.join(pending);
      yield* fixture.primary.receive(bytes(">2\r\n$10\r\ninvalidate\r\n_\r\n"));
      while ((yield* cache.snapshot).entries !== 0) yield* Effect.yieldNow;

      const refilled = yield* Effect.forkChild(cache.getBytes("k"));
      yield* sent(fixture.primary, ["GET", "k"], "$1\r\nv\r\n");
      yield* Fiber.join(refilled);
      yield* fixture.primary.end;
      while ((yield* fixture.tracking.snapshot).healthy) yield* Effect.yieldNow;
      expect(yield* cache.snapshot).toMatchObject({ entries: 0 });
      expect(yield* Effect.flip(cache.getBytes("k"))).toMatchObject({ _tag: "ConnectionError" });
    }),
);

it.effect("CACHE: TTL and entry budgets evict without relying on wall-clock sleeps", () =>
  Effect.gen(function* () {
    const fixture = yield* trackingFixture();
    const cache = yield* fixture.tracking.cache({ maxEntries: 1, maxBytes: 16, maxTtlMillis: 10 });
    const first = yield* Effect.forkChild(cache.getBytes("a"));
    yield* fixture.enable;
    yield* sent(fixture.primary, ["GET", "a"], "$1\r\nA\r\n");
    yield* Fiber.join(first);
    yield* TestClock.adjust(10);

    const expired = yield* Effect.forkChild(cache.getBytes("a"));
    yield* sent(fixture.primary, ["GET", "a"], "$1\r\nB\r\n");
    yield* Fiber.join(expired);
    const second = yield* Effect.forkChild(cache.getBytes("b"));
    yield* sent(fixture.primary, ["GET", "b"], "$1\r\nC\r\n");
    yield* Fiber.join(second);
    expect(yield* cache.snapshot).toMatchObject({ entries: 1, bytes: 7 });
    const evicted = yield* Effect.forkChild(cache.getBytes("a"));
    yield* sent(fixture.primary, ["GET", "a"], "$1\r\nD\r\n");
    expect(yield* Fiber.join(evicted)).toEqual(Option.some(bytes("D")));
  }),
);

it.effect("CACHE: tracked writes invalidate locally before a mutation without replay", () =>
  Effect.gen(function* () {
    const fixture = yield* trackingFixture();
    const cache = yield* fixture.tracking.cache();
    const read = yield* Effect.forkChild(cache.getBytes("k"));
    yield* fixture.enable;
    yield* sent(fixture.primary, ["GET", "k"], "$1\r\nv\r\n");
    yield* Fiber.join(read);

    const write = yield* Effect.forkChild(fixture.tracking.execute(Commands.set("k", "new")));
    yield* sent(fixture.primary, ["SET", "k", "new"]);
    expect(yield* cache.snapshot).toMatchObject({ entries: 0 });
    yield* fixture.primary.end;
    expect(yield* Fiber.await(write)).toMatchObject({ _tag: "Failure" });
    expect(fixture.opens()).toBe(1);
  }),
);

it.effect("CACHE: raw byte storage cannot confuse different application codecs", () =>
  Effect.gen(function* () {
    const fixture = yield* trackingFixture();
    const cache = yield* fixture.tracking.cache();
    const first = yield* Effect.forkChild(cache.getKey(RedisKey.json("k", Schema.Number)));
    yield* fixture.enable;
    yield* sent(fixture.primary, ["GET", "k"], "$1\r\n7\r\n");
    expect(yield* Fiber.join(first)).toEqual(Option.some(7));

    expect(yield* cache.getKey(RedisKey.text("k"))).toEqual(Option.some("7"));
    expect(yield* Effect.flip(cache.getKey(RedisKey.json("k", Schema.String)))).toMatchObject({
      _tag: "PayloadError",
    });
    expect((yield* fixture.primary.written).length).toBe(3);
  }),
);
