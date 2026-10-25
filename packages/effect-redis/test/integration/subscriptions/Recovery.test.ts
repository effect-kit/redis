import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";

import { bytes, sent } from "#test/support/connection/Controlled";
import { acknowledgment, channelMessage, pubsubFixture } from "#test/support/subscriptions/Fixture";

it.effect("PUSH: default disconnect fails and does not resubscribe", () =>
  Effect.gen(function* () {
    const fixture = yield* pubsubFixture();
    const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c"]));
    yield* sent(fixture.primary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
    const subscription = yield* Fiber.join(opening);

    yield* fixture.primary.end;
    expect(yield* Effect.flip(Stream.runDrain(subscription.messages))).toMatchObject({
      _tag: "ConnectionError",
    });
    expect(fixture.opens()).toBe(1);
    yield* fixture.finish;
  }),
);

it.effect(
  "PUSH: explicit resubscription exposes the lost generation before ready and new messages",
  () =>
    Effect.gen(function* () {
      const fixture = yield* pubsubFixture();
      const opening = yield* Effect.forkChild(
        fixture.pubsub.subscribe(["c"], { recovery: "resubscribe" }),
      );
      yield* sent(fixture.primary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
      const subscription = yield* Fiber.join(opening);
      expect(yield* Stream.runCollect(subscription.events.pipe(Stream.take(1)))).toEqual([
        { _tag: "Ready", generation: 1 },
      ]);

      yield* fixture.primary.end;
      yield* sent(fixture.secondary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
      yield* fixture.secondary.receive(bytes(channelMessage("new")));
      expect(yield* Stream.runCollect(subscription.events.pipe(Stream.take(3)))).toMatchObject([
        { _tag: "DeliveryGap", generation: 1 },
        { _tag: "Ready", generation: 2 },
        { _tag: "Message", generation: 2, payload: bytes("new") },
      ]);
      yield* fixture.finish;
    }),
);

it.effect("PUSH: message-only consumption cannot hide a recovery gap", () =>
  Effect.gen(function* () {
    const fixture = yield* pubsubFixture();
    const opening = yield* Effect.forkChild(
      fixture.pubsub.subscribe(["c"], { recovery: "resubscribe" }),
    );
    yield* sent(fixture.primary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
    const subscription = yield* Fiber.join(opening);
    yield* fixture.primary.end;
    expect(yield* Effect.flip(Stream.runDrain(subscription.messages))).toMatchObject({
      reason: "delivery-gap",
      generation: 1,
    });

    yield* sent(fixture.secondary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
    yield* fixture.finish;
  }),
);
