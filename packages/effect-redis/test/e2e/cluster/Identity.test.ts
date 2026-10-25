import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { makeRedisCluster } from "#/cluster/RedisCluster";
import { keySlot } from "#/cluster/Slot";
import * as Commands from "#/commands/index";
import { layer } from "#/node";
import { clusterFixture } from "#test/support/cluster/Fixture";
import { currentClusterCases } from "#test/support/cluster/Targets";
import { certificates } from "#test/support/tls/Certificates";

it.live.each(currentClusterCases)(
  "CLUSTER: $target.fixture $protocol translated TLS identities also apply to ASK targets",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const tls = yield* certificates();
      const { client, nodes, config, addressMap } = yield* clusterFixture(target, protocol, {
        tls,
      });
      const [source, destination] = nodes;
      if (source === undefined || destination === undefined)
        return yield* Effect.die("Missing nodes");
      const key = "tls{bar}";
      const slot = keySlot(key);
      yield* client
        .node(destination.id)
        .execute(Commands.clusterSetSlot(slot, { mode: "IMPORTING", node: source.id }));
      yield* client
        .node(source.id)
        .execute(Commands.clusterSetSlot(slot, { mode: "MIGRATING", node: destination.id }));

      yield* client.redis.set(key, new Uint8Array([0, 255, 128]));
      expect(yield* client.redis.getBytes(key)).toEqual(Option.some(new Uint8Array([0, 255, 128])));
      expect(config.endpoint._tag).toBe("Tcp");
      if (config.endpoint._tag !== "Tcp" || config.endpoint.tls === undefined)
        return yield* Effect.die("Missing TLS fixture");
      const wrong = {
        ...config,
        endpoint: {
          ...config.endpoint,
          tls: { ...config.endpoint.tls, serverName: "wrong.internal" },
        },
      };
      expect(
        yield* Effect.flip(makeRedisCluster(wrong, { addressMap }).pipe(Effect.provide(layer))),
      ).toMatchObject({ _tag: "ConnectionError", delivery: "unsent" });
    }),
  90_000,
);

it.live.each(currentClusterCases.filter(({ target }) => target.product === "valkey"))(
  "CLUSTER: $target.fixture $protocol configured multi-DB keeps values and leases isolated",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { client, config, addressMap } = yield* clusterFixture(target, protocol, {
        database: 5,
      });
      const zero = yield* makeRedisCluster({ ...config, database: 0 }, { addressMap }).pipe(
        Effect.provide(layer),
      );
      yield* client.redis.set("db{bar}", "five");
      yield* zero.redis.set("db{bar}", "zero");

      expect(yield* client.redis.get("db{bar}")).toEqual(Option.some("five"));
      expect(yield* zero.redis.get("db{bar}")).toEqual(Option.some("zero"));
      expect(
        yield* Effect.flip(
          client.withSession({ key: "db{bar}" }, (session) => session.selectDatabase(0)),
        ),
      ).toMatchObject({ _tag: "ClusterError", reason: "database", delivery: "unsent" });
      expect(
        yield* Effect.flip(makeRedisCluster(config, { addressMap }).pipe(Effect.provide(layer))),
      ).toMatchObject({ reason: "database" });
    }),
  90_000,
);
