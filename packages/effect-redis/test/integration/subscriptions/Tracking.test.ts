import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";

import { Commands } from "#/index";
import { bytes, sent } from "#test/support/connection/Controlled";
import { invalidation, trackingFixture } from "#test/support/subscriptions/TrackingFixture";

it.effect.each(["resp2", "resp3"] as const)(
  "TRACK: %s binds tracking to the correct data and invalidation connections",
  (protocol) =>
    Effect.gen(function* () {
      const fixture = yield* trackingFixture(protocol);
      const opening = yield* Effect.forkChild(fixture.tracking.start);
      yield* fixture.enable;
      yield* Fiber.join(opening);
      expect(yield* fixture.tracking.snapshot).toMatchObject({
        healthy: true,
        redirected: protocol === "resp2",
      });

      const read = yield* Effect.forkChild(fixture.tracking.getBytes("k"));
      yield* sent(fixture.primary, ["GET", "k"], "$1\r\nv\r\n");
      expect(yield* Fiber.join(read)).toMatchObject({ value: bytes("v") });
    }),
);

it.effect("TRACK: an interleaved invalidation does not consume a read response", () =>
  Effect.gen(function* () {
    const fixture = yield* trackingFixture();
    const read = yield* Effect.forkChild(fixture.tracking.getBytes("k"));
    yield* fixture.enable;
    yield* sent(fixture.primary, ["GET", "k"]);
    yield* fixture.primary.receive(bytes(`${invalidation("k")}$1\r\nv\r\n`));

    expect(yield* Fiber.join(read)).toMatchObject({ value: bytes("v") });
    expect(
      yield* Stream.runCollect(fixture.tracking.invalidations.pipe(Stream.take(1))),
    ).toMatchObject([{ _tag: "Invalidate", keys: [bytes("k")] }]);
  }),
);

it.effect("TRACK: opt-in caching and the target cannot be interleaved by another request", () =>
  Effect.gen(function* () {
    const fixture = yield* trackingFixture("resp3", { tracking: { mode: "optin" } });
    const first = yield* Effect.forkChild(fixture.tracking.getBytes("a"));
    yield* fixture.enable;
    yield* sent(fixture.primary, ["CLIENT", "CACHING", "YES"]);
    const second = yield* Effect.forkChild(fixture.tracking.execute(Commands.getBytes("b")));
    yield* fixture.primary.receive(bytes("+OK\r\n"));
    yield* sent(fixture.primary, ["GET", "a"], "$1\r\nA\r\n");
    yield* sent(fixture.primary, ["GET", "b"], "$1\r\nB\r\n");

    expect(yield* Fiber.join(first)).toMatchObject({ value: bytes("A") });
    expect(yield* Fiber.join(second)).toMatchObject({ value: bytes("B") });
  }),
);

it.effect(
  "TRACK: subscription and session descriptors cannot escape through ordinary tracked execution",
  () =>
    Effect.gen(function* () {
      const fixture = yield* trackingFixture();
      expect(
        yield* Effect.flip(fixture.tracking.execute(Commands.clientTracking(false))),
      ).toMatchObject({ reason: "unsupported-command" });
      expect(fixture.opens()).toBe(0);
    }),
);

it.effect("TRACK: redirected receiver loss retires the data cohort", () =>
  Effect.gen(function* () {
    const fixture = yield* trackingFixture("resp2");
    const opening = yield* Effect.forkChild(fixture.tracking.start);
    yield* fixture.enable;
    yield* Fiber.join(opening);
    yield* fixture.secondary.end;

    while ((yield* fixture.tracking.snapshot).healthy) yield* Effect.yieldNow;
    expect(yield* Effect.flip(fixture.tracking.getBytes("k"))).toMatchObject({
      _tag: "ConnectionError",
    });
    expect(fixture.opens()).toBe(2);
  }),
);
