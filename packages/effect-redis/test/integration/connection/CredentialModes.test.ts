import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";

import { sent } from "#test/support/connection/Controlled";
import { nativeCredentialFixture } from "#test/support/credentials/Native";
import { acknowledgment } from "#test/support/subscriptions/Fixture";

it.effect(
  "credential retirement interrupts a blocking pop without claiming it was not consumed",
  () =>
    Effect.gen(function* () {
      const fixture = yield* nativeCredentialFixture({
        mode: "token-expiry",
        retireBeforeMillis: 0,
      });
      const pop = yield* fixture.sessions
        .blpop(["queue"], { blockFor: "forever" })
        .pipe(Effect.forkChild);
      yield* sent(fixture.second, ["AUTH", "synthetic-1"], "+OK\r\n");
      yield* sent(fixture.second, ["BLPOP", "queue", "0"]);

      yield* TestClock.adjust(1000);
      expect(yield* Effect.flip(Fiber.join(pop))).toMatchObject({
        _tag: "ConnectionError",
        delivery: "possibly-written",
      });
      expect(fixture.opens()).toBe(2);
      expect(fixture.calls()).toBe(1);
    }),
);

it.effect(
  "credential retirement ends a subscription instead of authenticating inside its message stream",
  () =>
    Effect.gen(function* () {
      const fixture = yield* nativeCredentialFixture({
        mode: "token-expiry",
        retireBeforeMillis: 0,
      });
      const opening = yield* fixture.pubsub.subscribe(["c"]).pipe(Effect.forkChild);
      yield* sent(fixture.second, ["AUTH", "synthetic-1"], "+OK\r\n");
      yield* sent(fixture.second, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
      const subscription = yield* Fiber.join(opening);

      yield* TestClock.adjust(1000);
      expect(yield* Effect.flip(Stream.runDrain(subscription.messages))).toMatchObject({
        _tag: "ConnectionError",
      });
      expect(fixture.opens()).toBe(2);
      expect(fixture.calls()).toBe(1);
    }),
);
