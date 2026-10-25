import { expect, it } from "@effect/vitest";
import { Duration, Effect, Option } from "effect";

import { simpleText } from "#/command/reply/Data";
import { keySlot, RedisScript, Reply } from "#/index";
import { awaitCluster, clusterFixture } from "#test/support/cluster/Fixture";
import { currentClusterCases } from "#test/support/cluster/Targets";
import { cryptoLayer } from "#test/support/commands/Crypto";
import { FixtureError } from "#test/support/servers/FixtureError";

it.live.each(currentClusterCases)(
  "CLUSTER: $target.fixture $protocol reshard uses ASK then MOVED and invalidates old cohorts",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { client, nodes } = yield* clusterFixture(target, protocol);
      const [source, destination] = nodes;
      if (source === undefined || destination === undefined)
        return yield* Effect.die("Missing cluster nodes");
      const key = "counter{bar}";
      const slot = keySlot(key);
      yield* client.redis.set(key, "0");
      const tracking = yield* client.tracking({ key }, { tracking: { mode: "optin" } });
      const cache = yield* tracking.cache();
      expect(yield* cache.getBytes(key)).toEqual(Option.some(new TextEncoder().encode("0")));
      const initial = yield* client.topology;

      yield* destination.request(["CLUSTER", "SETSLOT", String(slot), "IMPORTING", source.id]);
      yield* source.request(["CLUSTER", "SETSLOT", String(slot), "MIGRATING", destination.id]);
      yield* source.request(["MIGRATE", destination.address, "6379", key, "0", "5000"]);
      expect(yield* client.redis.get(key)).toEqual(Option.some("0"));
      expect(yield* Effect.flip(cache.getBytes(key))).toMatchObject({
        _tag: "ClusterError",
        reason: "topology-changed",
      });
      expect(yield* cache.snapshot).toMatchObject({ entries: 0, active: false });

      const scripts = yield* client.scripts({ key });
      const script = yield* RedisScript.make({
        source: "return redis.call('INCR', KEYS[1])",
        decode: Reply.integer,
      }).pipe(Effect.provide(cryptoLayer));
      expect(yield* scripts.execute(script, { keys: [key] })).toBe(1n);
      for (const node of nodes.slice(0, 3))
        yield* node.request(["CLUSTER", "SETSLOT", String(slot), "NODE", destination.id]);

      expect(yield* client.redis.get(key)).toEqual(Option.some("1"));
      expect((yield* client.topology).revision).toBeGreaterThan(initial.revision);
      const replacement = yield* client.tracking({ key }, { tracking: { mode: "optin" } });
      const newCache = yield* replacement.cache();
      expect(yield* newCache.getBytes(key)).toEqual(Option.some(new TextEncoder().encode("1")));
    }),
  90_000,
);

it.live.each(currentClusterCases)(
  "CLUSTER: $target.fixture $protocol primary loss preserves uncertainty and new work discovers promotion",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const fixture = yield* clusterFixture(target, protocol);
      const { client, nodes } = fixture;
      const replica = nodes[3];
      if (replica === undefined) return yield* Effect.die("Missing replica");
      const key = "durable{bar}";
      yield* client.withSession({ key }, (session) =>
        Effect.gen(function* () {
          yield* session.set(key, "replicated");
          expect(yield* session.waitForReplicas(1, { blockFor: Duration.seconds(5) })).toBe(1n);
        }),
      );

      yield* fixture.control(0, "kill");
      yield* awaitCluster(
        Effect.gen(function* () {
          const role = yield* replica.request(["ROLE"]);
          const kind = role._tag === "Array" ? role.values[0] : undefined;
          if (kind === undefined || (yield* simpleText(kind)) !== "master")
            return yield* new FixtureError({ stage: "cluster-promotion" });
        }),
      );
      const failed = yield* Effect.result(client.redis.get(key));
      expect(failed).toMatchObject({ _tag: "Failure", failure: { _tag: "ConnectionError" } });

      expect(yield* client.redis.get(key)).toEqual(Option.some("replicated"));
      expect((yield* client.topology).shards.some((shard) => shard.primary.id === replica.id)).toBe(
        true,
      );
    }),
  90_000,
);

it.live.each(currentClusterCases.filter(({ protocol }) => protocol === "resp3"))(
  "CLUSTER: $target.fixture actual network partition preserves failed-write evidence",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const fixture = yield* clusterFixture(target, protocol, { proxy: true });
      const { client, nodes } = fixture;
      const replica = nodes[3];
      if (replica === undefined) return yield* Effect.die("Missing replica");
      const key = "partition{bar}";
      yield* client.withSession({ key }, (session) =>
        session
          .set(key, "before")
          .pipe(Effect.andThen(session.waitForReplicas(1, { blockFor: Duration.seconds(5) }))),
      );
      yield* fixture.partition(0);
      const primary = nodes[0];
      if (primary === undefined) return yield* Effect.die("Missing primary");
      yield* awaitCluster(
        Effect.gen(function* () {
          const info = yield* primary.request(["CLUSTER", "INFO"]).pipe(Effect.flatMap(simpleText));
          if (!info.includes("cluster_state:fail"))
            return yield* new FixtureError({ stage: "cluster-isolation" });
        }),
      );
      expect(yield* Effect.flip(client.redis.set(key, "after"))).toMatchObject({
        _tag: "ServerError",
        code: "CLUSTERDOWN",
        delivery: "replied",
      });
      yield* awaitCluster(
        Effect.gen(function* () {
          const role = yield* replica.request(["ROLE"]);
          const kind = role._tag === "Array" ? role.values[0] : undefined;
          if (kind === undefined || (yield* simpleText(kind)) !== "master")
            return yield* new FixtureError({ stage: "cluster-promotion" });
        }),
      );
      expect(yield* client.redis.get(key)).toEqual(Option.some("before"));
    }),
  90_000,
);
