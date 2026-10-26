import { Context, Duration, Effect, Fiber, Layer, Option, Redacted, Result, Stream } from "effect";

import {
  Commands,
  Redis,
  RedisAdmin,
  RedisCredentials,
  RedisPubSub,
  RedisSessions,
  RedisStreams,
  decodeRedisConfig,
} from "@effect-kit/redis";

import { collect, resources } from "#test/runners/hardening/Memory";
import { readyLayer } from "#test/runners/hardening/Native";
import type { nativeAdapter } from "#test/runners/hardening/Native";
import { ensure, sameBytes } from "#test/runners/providers/scenarios/Assertions";
import { nativeInput } from "#test/support/client/Input";
import type { Input, MemorySample } from "#test/support/hardening/Contract";
import { heapSlope } from "#test/support/hardening/Statistics";

const cycle = Effect.fnUntraced(function* (input: Input, index: number) {
  const redis = yield* Redis;
  const sessions = yield* RedisSessions;
  const subscriptions = yield* RedisPubSub;
  const streams = yield* RedisStreams;
  const key = `${input.prefix}value`;
  const counter = `${input.prefix}counter`;
  const stream = `${input.prefix}stream`;
  const payload = new Uint8Array([0, 255, 128, 13, 10]);

  yield* redis.set(key, payload);
  yield* Effect.all(
    Array.from({ length: 16 }, () =>
      redis
        .getBytes(key)
        .pipe(
          Effect.tap((reply) =>
            Effect.sync(() =>
              ensure(
                Option.isSome(reply) && sameBytes(reply.value, payload),
                "soak-reply-ownership",
              ),
            ),
          ),
        ),
    ),
    { concurrency: 16 },
  );
  yield* redis.set(counter, "0");
  const pipeline = yield* redis.pipeline([Commands.incr(counter), Commands.getBytes(key)]);
  ensure(
    Result.getOrThrow(pipeline[0]) === 1n && Option.isSome(Result.getOrThrow(pipeline[1])),
    "soak-pipeline",
  );
  const transaction = yield* redis.transaction([Commands.incr(counter)]);
  ensure(
    transaction._tag === "Committed" && Result.getOrThrow(transaction.results[0]) === 2n,
    "soak-transaction",
  );

  const channel = `${input.prefix}channel`;
  const subscription = yield* subscriptions.subscribe([channel]);
  const receiving = yield* subscription.messages.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.forkChild,
  );
  yield* redis.publish(channel, payload);
  const messages = yield* Fiber.join(receiving).pipe(Effect.timeout(5000));
  ensure(messages.length === 1 && sameBytes(messages[0]?.payload, payload), "soak-pubsub");
  yield* subscription.close();
  const subscribers = yield* redis.pubsubNumSub([channel]);
  ensure(subscribers[0]?.[1] === 0n, "soak-server-unsubscribe");

  const group = `${input.prefix}group`;
  yield* redis.xgroupCreate(stream, group, "$", { mkstream: true });
  yield* redis.xadd(stream, "*", [["body", payload]], { trim: { by: "MAXLEN", threshold: 64 } });
  const delivered = yield* streams
    .readGroup(group, "consumer", [stream], { count: 1, block: { blockFor: Duration.seconds(5) } })
    .pipe(Stream.take(1), Stream.runCollect);
  const message = delivered[0];
  ensure(message !== undefined, "soak-stream-delivery");
  yield* redis.xack(stream, group, [message.entry.id]);
  yield* redis.xgroupDestroy(stream, group);

  if (index % 5 === 0) {
    yield* (yield* RedisCredentials).rotate;
    yield* redis.ping();
    const next = yield* redis.pipeline([Commands.incr(counter)]);
    ensure(Result.getOrThrow(next[0]) === 3n, "soak-future-session-rotation");
  }
  const leases = yield* sessions.snapshot;
  const listeners = yield* subscriptions.snapshot;
  ensure(
    leases.waiting === 0 && leases.leased === 0 && leases.connections <= 2,
    "soak-lease-bounds",
  );
  ensure(
    listeners.listeners === 0 &&
      listeners.interests === 0 &&
      listeners.retainedBytes === 0 &&
      listeners.retiring === 0,
    "soak-listener-bounds",
  );
});

export const soak = Effect.fnUntraced(function* (
  input: Input,
  adapter: Awaited<ReturnType<typeof nativeAdapter>>,
) {
  const config = nativeInput(yield* decodeRedisConfig(input.config));
  const name = `${input.prefix}app`;
  const layer = readyLayer({ ...input, config: { ...config, clientName: name } }, adapter);
  const monitor = yield* Layer.build(
    readyLayer({ ...input, config: { ...config, clientName: `${input.prefix}observer` } }, adapter),
  );
  const admin = Context.get(monitor, RedisAdmin);
  const remaining = Effect.gen(function* () {
    const clients = Redacted.value(yield* admin.clientList());
    return clients.split("\n").filter((line) => line.split(" ").includes(`name=${name}`)).length;
  });
  const started = performance.now();
  let cycles = 0;
  const samples: MemorySample[] = [];
  let baseline: MemorySample | undefined;
  let lastSample = started;
  while (performance.now() - started < input.soakMillis || cycles < 12) {
    yield* cycle(input, cycles).pipe(Effect.scoped, Effect.provide(layer));
    cycles++;
    // Server-side counts also cover Bun, whose active-resource API does not expose all handles.
    for (let attempt = 0; ; attempt++) {
      if ((yield* remaining) === 0) break;
      ensure(attempt < 100, "soak-server-client-cleanup");
      yield* Effect.sleep(10);
    }
    if (cycles >= 10 && (baseline === undefined || performance.now() - lastSample >= 1000)) {
      collect();
      const memory = process.memoryUsage();
      const sample = {
        elapsedMillis: performance.now() - started,
        cycles,
        heapUsedBytes: memory.heapUsed,
        rssBytes: memory.rss,
        sockets: yield* remaining,
        timeouts: resources("Timeout"),
      };
      baseline ??= sample;
      samples.push(sample);
      if (samples.length > 32) samples.shift();
      lastSample = performance.now();
    }
  }
  collect();
  const memory = process.memoryUsage();
  const final = {
    elapsedMillis: performance.now() - started,
    cycles,
    heapUsedBytes: memory.heapUsed,
    rssBytes: memory.rss,
    sockets: yield* remaining,
    timeouts: resources("Timeout"),
  };
  samples.push(final);
  ensure(
    baseline !== undefined && baseline.sockets !== null && samples.length >= 2,
    "soak-samples",
  );
  return {
    elapsedMillis: final.elapsedMillis,
    cycles,
    samples: [baseline, ...samples],
    heapGrowthBytes: final.heapUsedBytes - baseline.heapUsedBytes,
    retainedHeapSlopeBytesPerSecond: heapSlope(samples.slice(-16)),
    resourceGrowth:
      final.sockets + (final.timeouts ?? 0) - baseline.sockets - (baseline.timeouts ?? 0),
    checks: [
      "binary-ownership",
      "bounded-concurrency",
      "pipeline",
      "transaction",
      "pubsub-server-cleanup",
      "scoped-group-reader",
      "explicit-rotation-future-session",
      "zero-waiters-leases-listeners",
      "post-gc-memory",
      "joined-scope-cleanup",
      "server-client-cleanup",
    ],
  };
});
