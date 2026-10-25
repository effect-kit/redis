import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option } from "effect";

import { Commands } from "#/index";
import { bytes, sent } from "#test/support/connection/Controlled";
import { invalidation, trackingFixture } from "#test/support/subscriptions/TrackingFixture";

it.effect("CACHE: in-flight limits reject excess loads and release capacity after completion", () =>
  Effect.gen(function* () {
    const fixture = yield* trackingFixture();
    const cache = yield* fixture.tracking.cache({ maxInFlight: 1 });
    const first = yield* Effect.forkChild(cache.getBytes("a"));
    yield* fixture.enable;
    yield* sent(fixture.primary, ["GET", "a"]);
    expect(yield* Effect.flip(cache.getBytes("b"))).toMatchObject({ reason: "capacity" });
    yield* fixture.primary.receive(bytes("$1\r\nA\r\n"));
    yield* Fiber.join(first);

    const second = yield* Effect.forkChild(cache.getBytes("b"));
    yield* sent(fixture.primary, ["GET", "b"], "$1\r\nB\r\n");
    expect(yield* Fiber.join(second)).toEqual(Option.some(bytes("B")));
    expect(yield* cache.snapshot).toMatchObject({ inFlight: 0 });
  }),
);

it.effect("TRACK: ordinary array replies named message retain their command slot", () =>
  Effect.gen(function* () {
    const fixture = yield* trackingFixture();
    const request = yield* Effect.forkChild(
      fixture.tracking.execute(Commands.lrange("list", 0, -1)),
    );
    yield* fixture.enable;
    yield* sent(
      fixture.primary,
      ["LRANGE", "list", "0", "-1"],
      "*3\r\n$7\r\nmessage\r\n$1\r\nc\r\n$1\r\nv\r\n",
    );

    expect(yield* Fiber.join(request)).toEqual([bytes("message"), bytes("c"), bytes("v")]);
  }),
);

it.effect(
  "CACHE: explicit restart clears previous entries and establishes tracking on a new generation",
  () =>
    Effect.gen(function* () {
      const fixture = yield* trackingFixture();
      const cache = yield* fixture.tracking.cache();
      const first = yield* Effect.forkChild(cache.getBytes("k"));
      yield* fixture.enable;
      yield* sent(fixture.primary, ["GET", "k"], "$3\r\nold\r\n");
      yield* Fiber.join(first);
      yield* fixture.primary.end;
      while ((yield* fixture.tracking.snapshot).healthy) yield* Effect.yieldNow;

      const restarting = yield* Effect.forkChild(fixture.tracking.restart);
      yield* sent(fixture.secondary, ["HELLO", "3"], "%1\r\n$5\r\nproto\r\n:3\r\n");
      yield* sent(fixture.secondary, ["CLIENT", "TRACKING", "ON"], "+OK\r\n");
      yield* Fiber.join(restarting);
      expect(yield* cache.snapshot).toMatchObject({ entries: 0 });
      const second = yield* Effect.forkChild(cache.getBytes("k"));
      yield* sent(fixture.secondary, ["GET", "k"], "$3\r\nnew\r\n");
      expect(yield* Fiber.join(second)).toEqual(Option.some(bytes("new")));
      expect(fixture.opens()).toBe(2);
    }),
);

it.effect("CACHE: overflowing observers cannot prevent critical invalidation", () =>
  Effect.gen(function* () {
    const fixture = yield* trackingFixture("resp3", { maxMessages: 1 });
    const cache = yield* fixture.tracking.cache();
    const first = yield* Effect.forkChild(cache.getBytes("k"));
    yield* fixture.enable;
    yield* sent(fixture.primary, ["GET", "k"], "$1\r\nv\r\n");
    yield* Fiber.join(first);
    yield* fixture.primary.receive(bytes(invalidation("k")));
    while ((yield* cache.snapshot).entries !== 0) yield* Effect.yieldNow;

    expect(yield* fixture.tracking.snapshot).toMatchObject({ healthy: true });
    const refilled = yield* Effect.forkChild(cache.getBytes("k"));
    yield* sent(fixture.primary, ["GET", "k"], "$1\r\nw\r\n");
    expect(yield* Fiber.join(refilled)).toEqual(Option.some(bytes("w")));
  }),
);

it.effect("CACHE: entry and key byte limits bypass oversized storage", () =>
  Effect.gen(function* () {
    const fixture = yield* trackingFixture();
    const cache = yield* fixture.tracking.cache({ maxBytes: 8, maxKeyBytes: 1 });
    const first = yield* Effect.forkChild(cache.getBytes("long"));
    yield* fixture.enable;
    yield* sent(fixture.primary, ["GET", "long"], "$1\r\nv\r\n");
    yield* Fiber.join(first);
    expect(yield* cache.snapshot).toMatchObject({ entries: 0 });
    const oversized = yield* Effect.forkChild(cache.getBytes("k"));
    yield* sent(fixture.primary, ["GET", "k"], "$5\r\nlarge\r\n");
    yield* Fiber.join(oversized);
    expect(yield* cache.snapshot).toMatchObject({ entries: 0 });
  }),
);
