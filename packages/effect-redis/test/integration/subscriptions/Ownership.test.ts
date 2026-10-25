import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";

import { decodeRedisConfig, makeRedisPubSub, Transport } from "#/index";
import { bytes, sent } from "#test/support/connection/Controlled";
import { acknowledgment, channelMessage, pubsubFixture } from "#test/support/subscriptions/Fixture";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

it.effect(
  "PUSH: simultaneous consumers fail explicitly rather than splitting a subscription stream",
  () =>
    Effect.gen(function* () {
      const fixture = yield* pubsubFixture();
      const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c"]));
      yield* sent(fixture.primary, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
      const subscription = yield* Fiber.join(opening);
      const first = yield* Effect.forkChild(
        Stream.runCollect(subscription.messages.pipe(Stream.take(1))),
      );
      yield* Effect.yieldNow;
      expect(yield* Effect.flip(Stream.runDrain(subscription.events))).toMatchObject({
        reason: "concurrent-consumer",
      });

      yield* fixture.primary.receive(bytes(channelMessage("delivered")));
      expect(yield* Fiber.join(first)).toMatchObject([{ payload: bytes("delivered") }]);
      yield* fixture.finish;
    }),
);

it.effect("PUSH: each local listener owns payload and attribute bytes", () =>
  Effect.gen(function* () {
    const fixture = yield* pubsubFixture({}, "resp3");
    const opening = yield* Effect.forkChild(fixture.pubsub.subscribe(["c"]));
    yield* sent(fixture.primary, ["HELLO", "3"], "%1\r\n$5\r\nproto\r\n:3\r\n");
    yield* sent(
      fixture.primary,
      ["SUBSCRIBE", "c"],
      acknowledgment("subscribe").replace("*3", ">3"),
    );
    const first = yield* Fiber.join(opening);
    const second = yield* fixture.pubsub.subscribe(["c"]);
    yield* fixture.primary.receive(
      bytes(`|1\r\n$4\r\nmeta\r\n$1\r\nx\r\n${channelMessage("payload").replace("*3", ">3")}`),
    );
    const delivered = (yield* Stream.runCollect(first.messages.pipe(Stream.take(1))))[0];
    if (delivered === undefined) return yield* Effect.die("Missing first delivery");
    delivered.payload[0] = 0;
    const attribute = delivered.attributes[0]?.[1];
    if (attribute?._tag === "BlobString") attribute.value[0] = 0;

    expect(yield* Stream.runCollect(second.messages.pipe(Stream.take(1)))).toMatchObject([
      {
        payload: bytes("payload"),
        attributes: [
          [
            { _tag: "BlobString", value: bytes("meta") },
            { _tag: "BlobString", value: bytes("x") },
          ],
        ],
      },
    ]);
    yield* fixture.finish;
  }),
);

it.effect(
  "PUSH: physical cleanup defects prevent replacement and remain visible at scope closure",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeControlledTransport();
      const native = yield* Transport.pipe(Effect.provide(fixture.layer));
      const ownerScope = yield* Scope.make();
      let opens = 0;
      const transport = Layer.succeed(Transport, {
        open: (config) =>
          Effect.gen(function* () {
            opens++;
            const physical = yield* native.open(config);
            return {
              ...physical,
              close: physical.close.pipe(Effect.andThen(Effect.die("physical-cleanup"))),
            };
          }),
      });
      const config = yield* decodeRedisConfig({
        endpoint: { host: "localhost" },
        protocol: "resp2",
      });
      const pubsub = yield* makeRedisPubSub(config).pipe(
        Scope.provide(ownerScope),
        Effect.provide(transport),
      );
      const opening = yield* Effect.forkChild(pubsub.subscribe(["c"]));
      yield* sent(fixture, ["SUBSCRIBE", "c"], acknowledgment("subscribe"));
      const subscription = yield* Fiber.join(opening);
      yield* fixture.end;
      yield* Effect.exit(Stream.runDrain(subscription.messages));

      const replacement = yield* Effect.exit(pubsub.subscribe(["d"]));
      expect(replacement._tag).toBe("Failure");
      if (Exit.isFailure(replacement)) expect(Cause.hasDies(replacement.cause)).toBe(true);
      expect(opens).toBe(1);
      const closed = yield* Effect.exit(Scope.close(ownerScope, Exit.void));
      expect(closed._tag).toBe("Failure");
    }),
);
