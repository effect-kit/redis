import { expect, it } from "@effect/vitest";
import { Duration, Effect, Option, Stream } from "effect";

import { primaryForSlot } from "#/cluster/topology/Types";
import { Commands, keySlot, Reply } from "#/index";
import { awaitCluster, clusterFixture } from "#test/support/cluster/Fixture";
import { currentClusterCases } from "#test/support/cluster/Targets";
import { FixtureError } from "#test/support/servers/FixtureError";

it.live.each(currentClusterCases)(
  "CLUSTER: $target.fixture $protocol explicit administration and atomic slot migration",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { client, nodes } = yield* clusterFixture(target, protocol);
      const [source, destination] = nodes;
      if (source === undefined || destination === undefined)
        return yield* Effect.die("Missing nodes");
      const key = "atomic{bar}";
      const slot = keySlot(key);
      yield* client.withSession({ key }, (session) =>
        session
          .set(key, "value")
          .pipe(Effect.andThen(session.waitForReplicas(1, { blockFor: Duration.seconds(5) }))),
      );
      expect(yield* client.node(source.id).execute(Commands.clusterKeySlot(key))).toBe(
        BigInt(slot),
      );
      expect(yield* client.node(source.id).execute(Commands.clusterCountKeysInSlot(slot))).toBe(1n);
      expect(
        yield* client.node(source.id).execute(Commands.clusterGetKeysInSlot(slot, 10)),
      ).toEqual([new TextEncoder().encode(key)]);
      expect(
        yield* client.node(source.id).execute(Commands.clusterReplicas(source.id)),
      ).toHaveLength(1);
      expect(yield* client.node(source.id).execute(Commands.clusterSlaves(source.id))).toHaveLength(
        1,
      );
      expect(
        yield* client.node(source.id).execute(Commands.clusterCountFailureReports(destination.id)),
      ).toBe(0n);
      yield* client.node(source.id).execute(Commands.clusterSaveConfig());
      expect(yield* client.node(source.id).execute(Commands.clusterBumpEpoch())).toHaveProperty(
        "epoch",
      );

      if (target.product === "redis") {
        const task = yield* client
          .node(destination.id)
          .execute(Commands.clusterMigrationImport([[slot, slot]]));
        expect(task.length).toBeGreaterThan(0);
        yield* awaitCluster(
          Effect.gen(function* () {
            const topology = yield* client.refresh;
            if (primaryForSlot(topology, slot)?.primary.id !== destination.id)
              return yield* new FixtureError({ stage: "cluster-atomic-migration" });
          }),
        );
        expect(
          yield* client.node(destination.id).execute(Commands.clusterMigrationStatus({ id: task })),
        ).not.toHaveLength(0);
        expect(
          yield* client.node(destination.id).execute(Commands.clusterMigrationCancel("ALL")),
        ).toBeGreaterThanOrEqual(0n);
        yield* client.node(source.id).execute(Commands.trimSlots([[slot, slot]]));
      } else {
        yield* client
          .node(source.id)
          .execute(
            Commands.clusterMigrateSlots([{ ranges: [[slot, slot]], node: destination.id }]),
          );
        yield* awaitCluster(
          Effect.gen(function* () {
            const topology = yield* client.refresh;
            if (primaryForSlot(topology, slot)?.primary.id !== destination.id)
              return yield* new FixtureError({ stage: "cluster-atomic-migration" });
          }),
        );
        expect(
          yield* client.node(source.id).execute(Commands.clusterGetSlotMigrations()),
        ).not.toHaveLength(0);
        expect(
          yield* Effect.flip(
            client.node(source.id).execute(Commands.clusterCancelSlotMigrations()),
          ),
        ).toMatchObject({ _tag: "ServerError", code: "ERR" });
        expect(
          yield* client
            .node(destination.id)
            .execute(Commands.clusterSlotStats({ range: [slot, slot] })),
        ).toHaveLength(1);
      }
      expect(yield* client.redis.get(key)).toEqual(Option.some("value"));

      if (target.product === "valkey") {
        const nativeScan = yield* client.scanCluster({ slot, count: 10 }).pipe(Stream.runCollect);
        expect(nativeScan).toContainEqual(new TextEncoder().encode(key));
        yield* client.node(destination.id).execute(Commands.clusterFlushSlot(slot, "SYNC"));
      } else {
        expect(
          yield* Effect.flip(client.admin(destination.id).flushSlots([[slot, slot]], "SYNC")),
        ).toMatchObject({ _tag: "ServerError", code: "ERR" });
        yield* client.redis.del([key]);
      }
      expect(yield* client.redis.get(key)).toEqual(Option.none());

      yield* client.redis.rpush("list{bar}", ["job"]);
      expect(yield* client.blpop(["list{bar}"], { blockFor: Duration.seconds(1) })).toEqual(
        Option.some([new TextEncoder().encode("list{bar}"), new TextEncoder().encode("job")]),
      );
      const id = yield* client.redis.xadd("stream{bar}", "*", [["f", "v"]]);
      const streams = client.streams({ key: "stream{bar}" });
      expect(
        (yield* streams.read([["stream{bar}", "0-0"]]).pipe(Stream.take(1), Stream.runCollect))[0]
          ?.entry.id,
      ).toBe(id);

      const library =
        "#!lua name=clusterlib\nredis.register_function('cluster_get', function(keys, args) return redis.call('GET', keys[1]) end)";
      yield* client.onPrimaries(Commands.functionLoad(library)).pipe(
        Stream.runForEach(({ result }) => {
          expect(result._tag).toBe("Success");
          return Effect.void;
        }),
      );
      expect(
        yield* client.redis.fcall(
          "cluster_get",
          { keys: ["list{bar}:missing"] },
          Reply.optional(Reply.text),
        ),
      ).toEqual(Option.none());
    }),
  90_000,
);
