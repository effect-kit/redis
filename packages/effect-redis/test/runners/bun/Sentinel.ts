import { Deferred, Duration, Effect, Fiber, Option, Stream } from "effect";

import { core, ensure, equalBytes } from "#test/runners/bun/Runtime";
import { addressMap, topologyBarrier } from "#test/runners/bun/Topology";
import type { TopologyInput } from "#test/runners/bun/Topology";

export const sentinel = Effect.fnUntraced(function* (input: TopologyInput) {
  const config = yield* core.decodeSentinelConfig(input.config);
  const tlsConfig =
    input.tls === undefined
      ? undefined
      : yield* core.decodeRedisConfig({ endpoint: { host: "localhost", tls: input.tls } });
  const dataTls = tlsConfig?.endpoint._tag === "Tcp" ? tlsConfig.endpoint.tls : undefined;
  const client = yield* core.makeRedisSentinel(config, {
    addressMap: addressMap(input),
    refreshIntervalMillis: 50,
    ...(dataTls === undefined ? {} : { dataTls }),
  });
  const payload = new Uint8Array([0, 255, 128]);

  yield* client.withSession((session) =>
    Effect.gen(function* () {
      yield* session.set("bun:stable", payload);
      yield* session.set("bun:counter", "0");
      ensure(
        (yield* session.waitForReplicas(2, { blockFor: Duration.seconds(2) })) === 2n,
        "Replica receipt missing",
      );
    }),
  );
  const tracking = yield* client.tracking({ tracking: { mode: "optin" } });
  const cache = yield* tracking.cache();
  ensure(Option.isSome(yield* cache.getBytes("bun:stable")), "Sentinel cache did not populate");
  const scripts = yield* client.scripts();
  const script = yield* core.RedisScript.make({
    source: "return redis.call('GET', KEYS[1])",
    decode: core.Reply.optional(core.Reply.blob),
  });
  ensure(
    Option.isSome(yield* scripts.execute(script, { keys: ["bun:stable"] })),
    "Sentinel script failed",
  );

  const leased = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const held = yield* client
    .withSession((session) =>
      Effect.gen(function* () {
        yield* session.watch(["bun:counter"]);
        yield* Deferred.succeed(leased, undefined);
        yield* Deferred.await(release);
        return yield* session.incr("bun:counter");
      }),
    )
    .pipe(Effect.result, Effect.forkChild);
  yield* Deferred.await(leased);

  yield* topologyBarrier(input, 0);
  const recovered = yield* client.redis.getBytes("bun:stable");
  ensure(
    Option.isSome(recovered) && equalBytes(recovered.value, payload),
    "Promoted primary lost acknowledged fixture data",
  );
  yield* Deferred.succeed(release, undefined);
  ensure((yield* Fiber.join(held))._tag === "Failure", "Old lease migrated to a different primary");
  ensure(!(yield* cache.snapshot).active, "Old Sentinel cache survived promotion");
  ensure(
    Option.isSome(yield* scripts.execute(script, { keys: ["bun:stable"] })),
    "New-primary script recovery failed",
  );
  const pubsub = yield* client.pubsub();
  const subscription = yield* pubsub.subscribe(["bun:after-promotion"]);
  yield* client.redis.publish("bun:after-promotion", payload);
  const messages = yield* Stream.runCollect(subscription.messages.pipe(Stream.take(1)));
  ensure(equalBytes(messages[0]?.payload, payload), "New-primary publication failed");
  yield* subscription.close();
  yield* client.close;

  return [
    "separate-auth",
    "mutual-tls",
    "role-verification",
    "replica-ack",
    "actual-promotion",
    "old-lease-rejected",
    "cache-retirement",
    "script-recovery",
    "pubsub",
  ];
});
