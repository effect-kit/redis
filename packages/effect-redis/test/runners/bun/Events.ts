import { Effect, Option, Schema, Stream } from "effect";

import { core, ensure, equalBytes } from "#test/runners/bun/Runtime";

export const events = Effect.fnUntraced(function* (input: unknown) {
  const config = yield* core.decodeRedisConfig(input);
  const connection = yield* core.makeConnection(config);
  const redis = core.makeRedis(core.makeExecutor(connection));
  const sessions = yield* core.makeRedisSessions(config);
  const prefix = `bun:events:${crypto.randomUUID()}`;
  const bytes = new Uint8Array([0, 255, 128]);

  const pubsub = yield* core.makeRedisPubSub(config);
  const subscription = yield* pubsub.subscribe([`${prefix}:channel`]);
  ensure(
    (yield* redis.publish(`${prefix}:channel`, bytes)) === 1n,
    "Subscription was not acknowledged",
  );
  const deliveries = yield* Stream.runCollect(subscription.messages.pipe(Stream.take(1)));
  ensure(equalBytes(deliveries[0]?.payload, bytes), "Pub/Sub bytes changed");
  yield* subscription.close();

  const tracking = yield* core.makeRedisTracking(config, { tracking: { mode: "optin" } });
  const cache = yield* tracking.cache({ maxEntries: 4 });
  yield* redis.set(`${prefix}:cache`, "first");
  ensure(Option.isSome(yield* cache.getBytes(`${prefix}:cache`)), "Cache miss did not read server");
  yield* redis.set(`${prefix}:cache`, "second");
  yield* Stream.runCollect(tracking.invalidations.pipe(Stream.take(1)));
  const refreshed = yield* cache.getBytes(`${prefix}:cache`);
  ensure(
    Option.isSome(refreshed) && new TextDecoder().decode(refreshed.value) === "second",
    "Invalidation retained stale bytes",
  );

  const streams = core.makeRedisStreams(redis, sessions);
  const envelope = core.StreamPayload.field(
    "body",
    core.PayloadCodec.json(Schema.Struct({ id: Schema.String })),
  );
  yield* redis.xgroupCreate(`${prefix}:stream`, "workers", "0", { mkstream: true });
  const id = yield* redis.xaddPayload(`${prefix}:stream`, "*", envelope, { id: "job" });
  const completed = yield* Stream.runCollect(
    streams
      .consume("workers", "bun", [`${prefix}:stream`], (message) =>
        envelope.decodeGroup(message.entry),
      )
      .pipe(Stream.take(1)),
  );
  ensure(
    completed[0]?._tag === "Processed" &&
      completed[0].message.entry.id === id &&
      completed[0].result.id === "job",
    "Stream processing changed payload",
  );
  ensure(
    (yield* redis.xpending(`${prefix}:stream`, "workers")).count === 0n,
    "Stream acknowledgment missing",
  );

  return [
    "pubsub",
    "tracking",
    "cache-invalidation",
    "stream-schema",
    "consumer-ack",
    "scoped-reader-cleanup",
  ];
});
