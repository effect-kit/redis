import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Stream } from "effect";

import {
  decodeRedisConfig,
  makeConnection,
  makeExecutor,
  makeRedis,
  makeRedisPubSub,
  makeRedisTracking,
} from "#/index";
import { layer } from "#/node";
import { bytes } from "#test/support/commands/CoreCase";
import { faultProxy } from "#test/support/networking/FaultProxy";
import { selectedEngine, serverTargets } from "#test/support/servers/Targets";
import { sessionBackend } from "#test/support/sessions/Backend";

const targets = serverTargets.filter(
  (target) =>
    ["redis", "valkey"].includes(target.fixture) &&
    (selectedEngine === "all" || selectedEngine === target.product),
);

it.live.each(targets)(
  "PUSH-LOSS: $fixture repeated resubscription exposes gaps and clears tracking cohorts",
  (target) =>
    Effect.gen(function* () {
      const { redis, server, prefix } = yield* sessionBackend(target, "resp2");
      const proxy = yield* faultProxy(server.port, { fragmentBytes: 1 });
      const config = yield* decodeRedisConfig({
        endpoint: { host: "127.0.0.1", port: proxy.port },
        protocol: "resp2",
      });
      const pubsub = yield* makeRedisPubSub(config, { reconnectDelayMillis: 0 }).pipe(
        Effect.provide(layer),
      );
      const tracking = yield* makeRedisTracking(config).pipe(Effect.provide(layer));
      const cache = yield* tracking.cache();
      const channel = `${prefix}:channel`;
      const key = `${prefix}:key`;
      const subscription = yield* pubsub.subscribe([channel], { recovery: "resubscribe" });
      yield* Stream.runCollect(subscription.events.pipe(Stream.take(1)));
      yield* redis.set(key, "initial");
      expect(yield* cache.getBytes(key)).toEqual(Option.some(bytes("initial")));

      for (let cycle = 1; cycle <= 2; cycle++) {
        yield* proxy.cut;
        expect(yield* Stream.runCollect(subscription.events.pipe(Stream.take(2)))).toMatchObject([
          { _tag: "DeliveryGap", generation: cycle },
          { _tag: "Ready", generation: cycle + 1 },
        ]);
        while ((yield* tracking.snapshot).healthy) yield* Effect.yieldNow;
        expect(yield* cache.snapshot).toMatchObject({ entries: 0 });
        expect(yield* Effect.flip(cache.getBytes(key))).toMatchObject({ _tag: "ConnectionError" });

        yield* redis.set(key, `generation-${cycle}`);
        yield* tracking.restart;
        expect(yield* cache.getBytes(key)).toEqual(Option.some(bytes(`generation-${cycle}`)));
        expect(yield* redis.publish(channel, `message-${cycle}`)).toBe(1n);
        expect(yield* Stream.runCollect(subscription.messages.pipe(Stream.take(1)))).toMatchObject([
          { payload: bytes(`message-${cycle}`), generation: cycle + 1 },
        ]);
      }
      yield* subscription.close();
    }),
);

it.live.each(targets)(
  "PUBLISH-LOSS: $fixture a delivered publication with a lost reply is never replayed",
  (target) =>
    Effect.gen(function* () {
      const { config, server, prefix } = yield* sessionBackend(target, "resp2");
      const pubsub = yield* makeRedisPubSub(config).pipe(Effect.provide(layer));
      const channel = `${prefix}:channel`;
      const subscription = yield* pubsub.subscribe([channel]);
      const proxy = yield* faultProxy(server.port, { holdReplies: true });
      const publisher = yield* makeConnection(
        yield* decodeRedisConfig({
          endpoint: { host: "127.0.0.1", port: proxy.port },
          protocol: "resp2",
        }),
      ).pipe(Effect.provide(layer));
      const redis = makeRedis(makeExecutor(publisher));
      const request = yield* Effect.forkChild(Effect.flip(redis.publish(channel, "once")));
      yield* proxy.firstReply;
      expect(yield* Stream.runCollect(subscription.messages.pipe(Stream.take(1)))).toMatchObject([
        { payload: bytes("once") },
      ]);
      yield* proxy.cut;

      expect(yield* Fiber.join(request)).toMatchObject({
        _tag: "ConnectionError",
        delivery: "possibly-written",
      });
      expect(yield* publisher.snapshot).toMatchObject({ connectionAttempts: 1 });
      yield* subscription.close();
    }),
);
