import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Effect, Option, Result, Stream } from "effect";

import { Commands, PayloadCodec, keySlot, makeRedisSearch } from "#/index";
import { clusterFixture } from "#test/support/cluster/Fixture";
import { moduleCases, moduleTarget } from "#test/support/modules/Backend";
import { moduleIdentity } from "#test/support/modules/Identity";
import { waitForSearchCount } from "#test/support/modules/SearchReady";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(moduleCases)(
  "MODULE-CLUSTER: $fixture.id $protocol routes module keys and fences global state",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const { client, nodes } = yield* clusterFixture(moduleTarget(fixture), protocol, {
        loadModules: fixture.loadModules,
      });
      const observed = yield* Effect.forEach(nodes, (node) =>
        node
          .request(["MODULE", "LIST"])
          .pipe(Effect.flatMap((reply) => moduleIdentity(reply, fixture.modules))),
      );
      const prefix = `module:${randomUUID()}`;
      const tag = `{${prefix}}`;
      const json = `${tag}:json`;
      const bloom = `${tag}:bloom`;
      const redis = client.redis;

      expect(yield* redis.jsonSet(json, "$", '{"n":1}')).toBe(true);
      expect(yield* redis.jsonGetWith(json, PayloadCodec.text)).toEqual(Option.some('{"n":1}'));
      yield* redis.jsonMset([
        [`${tag}:one`, "$", "1"],
        [`${tag}:two`, "$", "2"],
      ]);
      expect((yield* redis.jsonMget([`${tag}:one`, `${tag}:two`], ".")).length).toBe(2);
      expect(yield* Effect.flip(redis.jsonMget([json, "other-slot"], "."))).toMatchObject({
        _tag: "ClusterError",
        reason: "cross-slot",
        delivery: "unsent",
      });
      expect(yield* redis.bfAdd(bloom, "member")).toBe(true);
      expect(yield* redis.bfExists(bloom, "member")).toBe(true);
      const pipeline = yield* client.pipeline([
        Commands.jsonNumincrby(json, "$.n", 1),
        Commands.bfExists(bloom, "member"),
      ]);
      expect(pipeline[1]).toEqual(Result.succeed(true));
      const transaction = yield* client.transaction([Commands.jsonNumincrby(json, "$.n", 1)]);
      expect(transaction._tag).toBe("Committed");
      yield* client.withSession({ key: json }, (session) =>
        session.jsonSet(`${tag}:session`, "$", "true"),
      );
      expect(yield* Effect.flip(redis.ftList())).toMatchObject({
        _tag: "ClusterError",
        reason: "explicit-target-required",
      });

      const topology = yield* client.topology;
      const slot = keySlot(json);
      const owner = topology.shards.find((shard) =>
        shard.slots.some(([first, last]) => first <= slot && slot <= last),
      )?.primary;
      if (owner === undefined) return yield* Effect.die(new Error("Missing module owner"));
      const node = client.node(owner.id);
      if (fixture.engine === "redis") {
        const series = `${tag}:series`;
        yield* redis.tsCreate(series, { labels: [["suite", prefix]] });
        expect(yield* redis.tsAdd(series, 1000, 2)).toBe(1000n);
        expect(yield* redis.tsGet(series)).toEqual(Option.some({ timestamp: 1000n, value: 2 }));
        expect(yield* Effect.flip(redis.tsMget([`suite=${prefix}`]))).toMatchObject({
          _tag: "ClusterError",
          reason: "explicit-target-required",
        });
        expect((yield* node.tsMget([`suite=${prefix}`])).length).toBe(1);
        if (fixture.id === "redis-modules") {
          expect(
            yield* redis.vadd(`${tag}:vectors`, { _tag: "Values", coordinates: [1, 0] }, "one"),
          ).toBe(true);
          expect(yield* redis.vcard(`${tag}:vectors`)).toBe(1n);
        }
      }

      const index = `${tag}:index`;
      yield* node.ftCreate(index, [{ field: "title", type: "TEXT" }], {
        on: "HASH",
        prefixes: [`${tag}:doc:`],
      });
      yield* redis.hset(`${tag}:doc:one`, [["title", "hello"]]);
      yield* waitForSearchCount(node, index, 1n, "hello");
      expect((yield* node.ftSearch(index, "hello")).total).toBe(1n);
      if (fixture.engine === "redis") {
        const search = makeRedisSearch({
          withSession: (use) => client.withSession({ node: owner.id }, use),
        });
        expect(
          (yield* Stream.runCollect(
            search.aggregate(
              index,
              "hello",
              { steps: [{ _tag: "Load", fields: [{ field: "@title" }] }] },
              { count: 1 },
            ),
          )).length,
        ).toBe(1);
      }
      yield* node.ftDropindex(index);
      yield* recordFixture(`module-cluster-${fixture.id}-${protocol}`, {
        protocol,
        observed,
        nodes: nodes.map((serverNode) => ({
          build: serverNode.build,
          configurationDigest: serverNode.configurationDigest,
        })),
        checks: [
          "single-slot-keys",
          "cross-slot-before-write",
          "native-batch",
          "global-explicit-node",
          "node-bound-cursor",
        ],
      });
    }),
  120_000,
);
