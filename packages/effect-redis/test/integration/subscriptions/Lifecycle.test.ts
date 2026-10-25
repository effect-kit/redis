import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Stream } from "effect";

import { bytes, sent } from "#test/support/connection/Controlled";
import { acknowledgment, channelMessage, pubsubFixture } from "#test/support/subscriptions/Fixture";

it.effect("PUSH: acquisition waits for every acknowledgment and then exposes messages", () =>
  Effect.gen(function* () {
    const fixture = yield* pubsubFixture();
    const acquired = yield* Deferred.make<void>();
    const request = yield* Effect.forkChild(
      fixture.pubsub
        .subscribe(["c", "d"])
        .pipe(Effect.tap(() => Deferred.succeed(acquired, undefined))),
    );
    yield* sent(fixture.primary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
    yield* sent(fixture.primary, ["SUBSCRIBE", "d"]);
    expect(yield* Deferred.isDone(acquired)).toBe(false);

    yield* fixture.primary.receive(bytes(acknowledgment("subscribe", "d", 2)));
    const subscription = yield* Fiber.join(request);
    yield* fixture.primary.receive(bytes(channelMessage("payload")));
    expect(yield* Stream.runCollect(subscription.messages.pipe(Stream.take(1)))).toMatchObject([
      { _tag: "Message", channel: bytes("c"), payload: bytes("payload"), generation: 1 },
    ]);
    yield* fixture.finish;
  }),
);

it.effect("PUSH: duplicate local interests share wire ownership until the final release", () =>
  Effect.gen(function* () {
    const fixture = yield* pubsubFixture();
    const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c", "c"]));
    yield* sent(fixture.primary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
    const first = yield* Fiber.join(opening);
    const second = yield* fixture.pubsub.subscribe(["c"]);

    expect(yield* fixture.pubsub.snapshot).toMatchObject({ listeners: 2, interests: 1 });
    yield* first.close();
    expect((yield* fixture.primary.written).length).toBe(1);

    const closing = yield* Effect.forkChild(second.close());
    yield* sent(fixture.primary, ["UNSUBSCRIBE", "c"], acknowledgment("unsubscribe", "c", 0));
    yield* Fiber.join(closing);
    expect(yield* fixture.pubsub.snapshot).toMatchObject({
      listeners: 0,
      interests: 0,
      retainedBytes: 0,
    });
    yield* fixture.finish;
  }),
);

it.effect("PUSH: a slow listener fails without blocking another listener", () =>
  Effect.gen(function* () {
    const fixture = yield* pubsubFixture({ maxMessages: 2 });
    const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c"]));
    yield* sent(fixture.primary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
    const slow = yield* Fiber.join(opening);
    const fast = yield* fixture.pubsub.subscribe(["c"]);
    const reading = yield* Effect.forkChild(Stream.runCollect(fast.messages.pipe(Stream.take(2))));

    yield* fixture.primary.receive(bytes(channelMessage("first")));
    yield* Effect.yieldNow;
    yield* fixture.primary.receive(bytes(channelMessage("second")));
    expect(yield* Fiber.join(reading)).toMatchObject([
      { payload: bytes("first") },
      { payload: bytes("second") },
    ]);
    expect(yield* Effect.flip(Stream.runDrain(slow.messages))).toMatchObject({
      _tag: "SubscriptionError",
      reason: "overflow",
    });
    yield* fixture.finish;
  }),
);

it.effect("PUSH: retained byte limits fail a single oversized delivery", () =>
  Effect.gen(function* () {
    const fixture = yield* pubsubFixture({ maxBytes: 16 });
    const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c"]));
    yield* sent(fixture.primary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
    const subscription = yield* Fiber.join(opening);

    yield* fixture.primary.receive(bytes(channelMessage("oversized")));
    expect(yield* Effect.flip(Stream.runDrain(subscription.messages))).toMatchObject({
      reason: "overflow",
    });
    yield* fixture.finish;
  }),
);

it.effect(
  "PUSH: malformed acknowledgments fail acquisition instead of making a subscription ready",
  () =>
    Effect.gen(function* () {
      const fixture = yield* pubsubFixture();
      const opening = yield* Effect.forkChild(Effect.flip(fixture.pubsub.subscribe(["c"])));
      yield* sent(fixture.primary, ["SUBSCRIBE", "c"], acknowledgment("subscribe", "other"));

      expect(yield* Fiber.join(opening)).toMatchObject({ reason: "acknowledgment" });
      yield* fixture.finish;
    }),
);

it.effect("PUSH: RESP3 unknown pushes never become ordinary acknowledgments", () =>
  Effect.gen(function* () {
    const fixture = yield* pubsubFixture({}, "resp3");
    const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c"]));
    yield* sent(fixture.primary, ["HELLO", "3"], "%1\r\n$5\r\nproto\r\n:3\r\n");
    yield* sent(fixture.primary, ["SUBSCRIBE", "c"]);
    yield* fixture.primary.receive(
      bytes(`>2\r\n$6\r\nfuture\r\n:9\r\n${acknowledgment("subscribe").replace("*3", ">3")}`),
    );
    yield* Fiber.join(opening);

    expect(
      yield* Stream.runCollect(fixture.pubsub.unknownPushes.pipe(Stream.take(1))),
    ).toMatchObject([{ generation: 1, value: { _tag: "Push" } }]);
    yield* fixture.finish;
  }),
);
