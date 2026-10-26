import { expect, it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";

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
import { dockerServer } from "#test/support/servers/DockerServer";
import { selectedEngine, serverTargets } from "#test/support/servers/Targets";
import { sessionBackend } from "#test/support/sessions/Backend";

const targets = serverTargets.filter(
  (target) =>
    ["redis", "valkey"].includes(target.fixture) &&
    (selectedEngine === "all" || selectedEngine === target.product),
);

it.live.each(targets)(
  "CACHE-IDENTITY: $fixture isolates backend/database/binary keys while PubSub retains server-wide scope",
  (target) =>
    Effect.gen(function* () {
      const { redis, config, prefix } = yield* sessionBackend(target, "resp3");
      const other = yield* dockerServer(target);
      const otherConfig = yield* decodeRedisConfig({
        endpoint: { host: "127.0.0.1", port: other.port },
        protocol: "resp3",
      });
      const databaseConfig = { ...config, database: 1 };
      const databaseRedis = makeRedis(
        makeExecutor(yield* makeConnection(databaseConfig).pipe(Effect.provide(layer))),
      );
      const otherRedis = makeRedis(
        makeExecutor(yield* makeConnection(otherConfig).pipe(Effect.provide(layer))),
      );
      const key = `${prefix}:identity`;
      yield* redis.set(key, "backend-a-db0");
      yield* databaseRedis.set(key, "backend-a-db1");
      yield* otherRedis.set(key, "backend-b-db0");

      const clients = yield* Effect.forEach([config, databaseConfig, otherConfig], (selected) =>
        makeRedisTracking(selected).pipe(Effect.provide(layer)),
      );
      const caches = yield* Effect.forEach(clients, (tracking) => tracking.cache());
      expect(yield* Effect.forEach(caches, (cache) => cache.getBytes(key))).toEqual([
        Option.some(bytes("backend-a-db0")),
        Option.some(bytes("backend-a-db1")),
        Option.some(bytes("backend-b-db0")),
      ]);
      expect(yield* Effect.forEach(caches, (cache) => cache.getBytes(key))).toEqual([
        Option.some(bytes("backend-a-db0")),
        Option.some(bytes("backend-a-db1")),
        Option.some(bytes("backend-b-db0")),
      ]);

      const firstKey = new Uint8Array([...bytes(prefix), 255]);
      const secondKey = new Uint8Array([...bytes(prefix), 254]);
      const cache = caches[0];
      if (cache === undefined) return yield* Effect.die("Missing identity cache");
      yield* redis.set(firstKey, "first");
      yield* redis.set(secondKey, "second");
      expect(yield* cache.getBytes(firstKey)).toEqual(Option.some(bytes("first")));
      expect(yield* cache.getBytes(secondKey)).toEqual(Option.some(bytes("second")));

      const pubsub = yield* makeRedisPubSub(databaseConfig).pipe(Effect.provide(layer));
      const channel = `${prefix}:global-channel`;
      const subscription = yield* pubsub.subscribe([channel]);
      expect(yield* redis.publish(channel, "across-databases")).toBe(1n);
      expect(yield* Stream.runCollect(subscription.messages.pipe(Stream.take(1)))).toMatchObject([
        { payload: bytes("across-databases") },
      ]);
      yield* subscription.close();
    }),
);
