import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";

import { bytes, sent } from "#test/support/connection/Controlled";
import { acknowledgment, pubsubFixture } from "#test/support/subscriptions/Fixture";

it.effect(
  "PUSH: full control admission rejects an unregistered listener without cleanup defects",
  () =>
    Effect.gen(function* () {
      const fixture = yield* pubsubFixture({ maxWaiters: 1 });
      const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c"]));
      yield* sent(fixture.primary, ["SUBSCRIBE", "c"]);

      expect(yield* Effect.flip(fixture.pubsub.subscribe(["d"]))).toMatchObject({
        reason: "capacity",
      });
      yield* fixture.primary.receive(bytes(acknowledgment("subscribe")));
      yield* Fiber.join(opening);
      yield* fixture.finish;
    }),
);

it.effect("PUSH: repeated manual release reuses bounded ownership on one physical connection", () =>
  Effect.gen(function* () {
    const fixture = yield* pubsubFixture({ maxListeners: 1 });
    for (let cycle = 0; cycle < 16; cycle++) {
      const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c"]));
      yield* sent(fixture.primary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
      const subscription = yield* Fiber.join(opening);
      const closing = yield* Effect.forkChild(subscription.close());
      yield* sent(fixture.primary, ["UNSUBSCRIBE", "c"], acknowledgment("unsubscribe", "c", 0));
      yield* Fiber.join(closing);

      expect(yield* fixture.pubsub.snapshot).toMatchObject({
        listeners: 0,
        retiring: 0,
        interests: 0,
        retainedBytes: 0,
      });
    }
    expect(fixture.opens()).toBe(1);
    yield* fixture.finish;
  }),
);

it.effect(
  "PUSH: foreground admission pressure defers heartbeat without retiring a live socket",
  () =>
    Effect.gen(function* () {
      const fixture = yield* pubsubFixture({ maxWaiters: 1, heartbeatMillis: 100 });
      const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c"]));
      yield* sent(fixture.primary, ["SUBSCRIBE", "c"]);
      yield* TestClock.adjust(100);
      yield* fixture.primary.receive(bytes(acknowledgment("subscribe")));
      yield* Fiber.join(opening);

      expect(yield* fixture.pubsub.snapshot).toMatchObject({ listeners: 1 });
      expect((yield* fixture.primary.written).length).toBe(1);
      yield* fixture.finish;
    }),
);

it.effect("PUSH: cancellation during acquisition retires uncertain subscription state", () =>
  Effect.gen(function* () {
    const fixture = yield* pubsubFixture();
    const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c"]));
    yield* sent(fixture.primary, ["SUBSCRIBE", "c"]);
    yield* Fiber.interrupt(opening);

    expect(yield* fixture.pubsub.snapshot).toMatchObject({ listeners: 0 });
    yield* fixture.finish;
    expect(yield* fixture.primary.observations).toMatchObject({ closed: 1 });
  }),
);

it.effect(
  "PUSH: listener/interest limits reject new ownership without disturbing an active subscription",
  () =>
    Effect.gen(function* () {
      const fixture = yield* pubsubFixture({ maxListeners: 1, maxInterests: 1 });
      const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c"]));
      yield* sent(fixture.primary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
      yield* Fiber.join(opening);

      expect(yield* Effect.flip(fixture.pubsub.subscribe(["d"]))).toMatchObject({
        reason: "capacity",
      });
      expect(yield* fixture.pubsub.snapshot).toMatchObject({ listeners: 1, interests: 1 });
      expect((yield* fixture.primary.written).length).toBe(1);
      yield* fixture.finish;
    }),
);

it.effect(
  "PUSH: acknowledgment deadlines retire the connection and release acquisition ownership",
  () =>
    Effect.gen(function* () {
      const fixture = yield* pubsubFixture();
      const opening = yield* Effect.forkChild(Effect.flip(fixture.pubsub.subscribe(["c"])));
      yield* sent(fixture.primary, ["SUBSCRIBE", "c"]);
      yield* TestClock.adjust(fixture.config.commandTimeoutMillis);

      expect(yield* Fiber.join(opening)).toMatchObject({ _tag: "ConnectionError" });
      expect(yield* fixture.pubsub.snapshot).toMatchObject({ listeners: 0 });
      yield* fixture.finish;
    }),
);

it.effect("PUSH: heartbeats validate PONG and a missed heartbeat exposes failure", () =>
  Effect.gen(function* () {
    const fixture = yield* pubsubFixture({ heartbeatMillis: 100 });
    const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c"]));
    yield* sent(fixture.primary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
    const subscription = yield* Fiber.join(opening);
    yield* TestClock.adjust(100);
    yield* sent(fixture.primary, ["PING"], "*2\r\n$4\r\npong\r\n$0\r\n\r\n");
    yield* TestClock.adjust(100);
    yield* sent(fixture.primary, ["PING"]);
    yield* TestClock.adjust(fixture.config.commandTimeoutMillis);

    expect(yield* Effect.flip(Stream.runDrain(subscription.messages))).toMatchObject({
      _tag: "ConnectionError",
    });
    yield* fixture.finish;
  }),
);

it.effect("PUSH: pattern and sharded deliveries keep their distinct local routes", () =>
  Effect.gen(function* () {
    const fixture = yield* pubsubFixture();
    const patternOpen = yield* Effect.forkChild(fixture.pubsub.psubscribe(["p*"]));
    yield* sent(fixture.primary, ["PSUBSCRIBE", "p*"], acknowledgment("psubscribe", "p*"));
    const pattern = yield* Fiber.join(patternOpen);
    const shardOpen = yield* Effect.forkChild(fixture.pubsub.ssubscribe(["p1"]));
    yield* sent(fixture.primary, ["SSUBSCRIBE", "p1"], acknowledgment("ssubscribe", "p1"));
    const shard = yield* Fiber.join(shardOpen);
    yield* fixture.primary.receive(
      bytes(
        "*4\r\n$8\r\npmessage\r\n$2\r\np*\r\n$2\r\np1\r\n$1\r\na\r\n*3\r\n$8\r\nsmessage\r\n$2\r\np1\r\n$1\r\nb\r\n",
      ),
    );

    expect(yield* Stream.runCollect(pattern.messages.pipe(Stream.take(1)))).toMatchObject([
      { _tag: "PatternMessage", payload: bytes("a") },
    ]);
    expect(yield* Stream.runCollect(shard.messages.pipe(Stream.take(1)))).toMatchObject([
      { _tag: "ShardMessage", payload: bytes("b") },
    ]);
    yield* fixture.finish;
  }),
);
