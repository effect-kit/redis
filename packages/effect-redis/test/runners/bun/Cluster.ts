import { Effect, Option, Result, Stream } from "effect";

import { core, ensure, equalBytes } from "#test/runners/bun/Runtime";
import { addressMap, topologyBarrier } from "#test/runners/bun/Topology";
import type { TopologyInput } from "#test/runners/bun/Topology";

export const cluster = Effect.fnUntraced(function* (input: TopologyInput) {
  const config = yield* core.decodeRedisConfig(input.config);
  const client = yield* core.makeRedisCluster(config, { addressMap: addressMap(input) });
  const key = "bun:counter{bar}";
  const pipeline = yield* client.pipeline([core.Commands.set(key, "0"), core.Commands.incr(key)]);
  ensure(
    Result.isSuccess(pipeline[1]) && pipeline[1].success === 1n,
    "Cluster pipeline changed order",
  );
  const transaction = yield* client.transaction([core.Commands.incr(key)]);
  ensure(transaction._tag === "Committed", "Cluster transaction failed");
  const crossSlot = yield* Effect.flip(client.redis.mget(["{one}:a", "{two}:b"]));
  ensure(
    crossSlot._tag === "ClusterError" && crossSlot.reason === "cross-slot",
    "Cross-slot command was admitted",
  );

  const scripts = yield* client.scripts({ key });
  const script = yield* core.RedisScript.make({
    source: "return redis.call('GET', KEYS[1])",
    decode: core.Reply.optional(core.Reply.blob),
  });
  const initial = yield* scripts.execute(script, { keys: [key] });
  ensure(
    Option.isSome(initial) && equalBytes(initial.value, new TextEncoder().encode("2")),
    "Node-bound script failed",
  );
  const tracking = yield* client.tracking({ key }, { tracking: { mode: "optin" } });
  const cache = yield* tracking.cache();
  ensure(Option.isSome(yield* cache.getBytes(key)), "Cluster cache did not populate");
  const pubsub = yield* client.pubsub({ key });
  const subscription = yield* pubsub.ssubscribe(["bun:channel{bar}"]);
  ensure(
    (yield* client.redis.spublish("bun:channel{bar}", "event")) === 1n,
    "Shard publication failed",
  );
  const messages = yield* Stream.runCollect(subscription.messages.pipe(Stream.take(1)));
  ensure(
    equalBytes(messages[0]?.payload, new TextEncoder().encode("event")),
    "Shard publication changed bytes",
  );
  yield* subscription.close();

  yield* topologyBarrier(input, 0);
  const asking = yield* client.redis.get(key);
  ensure(Option.isSome(asking) && asking.value === "2", "ASK recovery failed");
  ensure(
    Option.isSome(yield* scripts.execute(script, { keys: [key] })),
    "ASK/NOSCRIPT adjacency failed",
  );
  ensure(!(yield* cache.snapshot).active, "Old Cluster cache survived ownership change");

  yield* topologyBarrier(input, 1);
  const moved = yield* client.redis.get(key);
  ensure(Option.isSome(moved) && moved.value === "2", "MOVED recovery failed");
  const replacement = yield* client.tracking({ key }, { tracking: { mode: "optin" } });
  ensure(
    Option.isSome(yield* (yield* replacement.cache()).getBytes(key)),
    "Replacement Cluster cache failed",
  );
  yield* client.close;

  return [
    "tls-address-map",
    "pipeline",
    "transaction",
    "cross-slot",
    "scripts",
    "sharded-pubsub",
    "ASK",
    "MOVED",
    "cache-retirement",
  ];
});
