import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import {
  Commands,
  Redis,
  RedisCluster,
  RedisCredentials,
  RedisProfiles,
  defineCommand,
  Reply,
} from "#/index";
import { RedisNode } from "#/node";
import { nativeInput } from "#test/support/client/Input";
import { clusterFixture } from "#test/support/cluster/Fixture";
import { currentClusterCases } from "#test/support/cluster/Targets";
import { certificates } from "#test/support/tls/Certificates";

it.live.each(currentClusterCases)(
  "READY-CLUSTER: $target.fixture $protocol TLS translation, profile and rotation preserve future work",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const tls = yield* certificates();
      const fixture = yield* clusterFixture(target, protocol, { tls });
      const profile = target.product === "redis" ? RedisProfiles.redis : RedisProfiles.valkey;
      const live = RedisNode.layerCluster({
        ...nativeInput(fixture.config),
        cluster: { addressMap: fixture.addressMap },
        profile: profile({ routing: "cluster" }),
        network: { allowedHosts: ["127.0.0.1"], allowedServerNames: ["localhost"] },
      });
      yield* Effect.gen(function* () {
        const redis = yield* Redis;
        yield* redis.set("ready{bar}", "0");
        expect(yield* redis.incr("ready{bar}")).toBe(1n);
        yield* (yield* RedisCredentials).rotate;
        const plan = yield* redis.compile([Commands.get("ready{bar}"), Commands.get("ready{bar}")]);
        expect(yield* plan.execute()).toEqual([Option.some("1"), Option.some("1")]);
        expect(
          yield* redis.batch([Commands.get("ready{bar}"), Commands.get("ready{bar}")]),
        ).toEqual([Option.some("1"), Option.some("1")]);
        expect(yield* redis.get("ready{bar}")).toEqual(Option.some("1"));

        const cluster = yield* RedisCluster;
        const node = (yield* cluster.topology).shards[0]?.primary.id;
        if (node === undefined) return yield* Effect.die("Missing primary node");
        const raw = yield* Commands.raw(["CLUSTER", "MYID"], {
          execution: "ordinary",
          routing: { _tag: "Keyless" },
        }).prepare;
        const identity = defineCommand({ ...raw, decode: Reply.text, serverErrors: "fail" });
        const pinned = cluster.node(node);
        const pinnedPlan = yield* pinned.compile([identity]);
        expect(yield* pinnedPlan.execute()).toEqual([node]);
        expect(yield* pinned.batch([identity])).toEqual([node]);
      }).pipe(Effect.provide(live));
    }),
  90_000,
);
