import { expect, it } from "@effect/vitest";
import { Effect, Option, Result, Stream } from "effect";

import { Commands, keySlot, RedisScript, Reply } from "#/index";
import { clusterFixture } from "#test/support/cluster/Fixture";
import { primaryCases } from "#test/support/commands/Backend";
import { cryptoLayer } from "#test/support/commands/Crypto";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(primaryCases)(
  "CLUSTER: $target.fixture $protocol routes typed commands, scripts and pinned batches",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { client, nodes } = yield* clusterFixture(target, protocol);
      const redis = client.redis;
      const keys = ["foo", "bar", "hello"];

      for (const key of keys) {
        const local = yield* (
          nodes[0]?.request(["CLUSTER", "KEYSLOT", key]) ?? Effect.die("Missing node")
        );
        expect(local).toMatchObject({ _tag: "Integer", value: BigInt(keySlot(key)) });
        yield* redis.set(key, `value:${key}`);
        expect(yield* redis.get(key)).toEqual(Option.some(`value:${key}`));
      }

      const topology = yield* client.topology;
      expect(topology.shards).toHaveLength(3);
      expect(topology.shards.every((shard) => shard.replicas.length === 1)).toBe(true);
      const key = "counter{foo}";
      yield* redis.set(key, "0");
      const pipeline = yield* client.pipeline([Commands.incr(key), Commands.get(key)] as const);
      expect(pipeline[0]).toEqual(Result.succeed(1n));
      expect(pipeline[1]).toEqual(Result.succeed(Option.some("1")));
      const transaction = yield* client.transaction([
        Commands.incr(key),
        Commands.get(key),
      ] as const);
      expect(transaction._tag).toBe("Committed");
      if (transaction._tag === "Committed")
        expect(transaction.results[0]).toEqual(Result.succeed(2n));

      expect(yield* Effect.flip(redis.mget(["foo", "bar"]))).toMatchObject({
        _tag: "ClusterError",
        reason: "cross-slot",
        delivery: "unsent",
      });
      expect(
        yield* Effect.flip(
          client.transaction([Commands.set("foo", "bad"), Commands.set("bar", "bad")]),
        ),
      ).toMatchObject({ reason: "cross-slot" });
      expect(yield* redis.get("foo")).toEqual(Option.some("value:foo"));

      const scripts = yield* client.scripts({ key });
      const script = yield* RedisScript.make({
        source: "return redis.call('INCR', KEYS[1])",
        decode: Reply.integer,
      }).pipe(Effect.provide(cryptoLayer));
      expect(yield* scripts.execute(script, { keys: [key] })).toBe(3n);
      expect(yield* scripts.execute(script, { keys: [key] })).toBe(4n);

      const scanned = yield* client.scanKeys().pipe(Stream.runCollect);
      expect(scanned.map((value) => new TextDecoder().decode(value))).toEqual(
        expect.arrayContaining([...keys, key]),
      );
      const node = topology.shards[0]?.primary;
      if (node === undefined) return yield* Effect.die("Missing primary");
      expect(yield* client.admin(node.id).dbsize()).toBeGreaterThanOrEqual(0n);
      expect(yield* Effect.flip(redis.scan())).toMatchObject({
        reason: "explicit-target-required",
      });

      yield* recordFixture(`cluster-${target.fixture}-${protocol}`, {
        scenario: "CLUSTER-ROUTING",
        protocol,
        nodes: nodes.map((server) => ({
          build: server.build,
          configurationDigest: server.configurationDigest,
        })),
        topology: { primaries: 3, replicas: 3 },
        pinned: target.reference,
      });
    }),
  90_000,
);
