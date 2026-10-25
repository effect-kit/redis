import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { makeRedisCluster } from "#/cluster/RedisCluster";
import { decodeRedisConfig } from "#/RedisConfig";
import { clusterControlled, slotReply } from "#test/support/cluster/Controlled";
import { bytes, sent } from "#test/support/connection/Controlled";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

it.effect("falls back from SHARDS only for the known unsupported-subcommand response", () =>
  Effect.gen(function* () {
    const seed = yield* makeControlledTransport();
    const config = yield* decodeRedisConfig({ endpoint: { host: "seed" }, protocol: "resp2" });
    const opening = yield* Effect.forkChild(
      makeRedisCluster(config).pipe(Effect.provide(seed.layer)),
    );
    yield* sent(
      seed,
      ["CLUSTER", "SHARDS"],
      "-ERR Unknown subcommand or wrong number of arguments for 'SHARDS'. Try CLUSTER HELP.\r\n",
    );
    yield* sent(seed, ["CLUSTER", "SLOTS"], slotReply("seed"));

    expect((yield* (yield* Fiber.join(opening)).topology).shards).toHaveLength(1);
  }),
);

it.effect("does not disguise discovery ACL rejection as a legacy fallback", () =>
  Effect.gen(function* () {
    const seed = yield* makeControlledTransport();
    const config = yield* decodeRedisConfig({ endpoint: { host: "seed" }, protocol: "resp2" });
    const opening = yield* Effect.forkChild(
      Effect.result(makeRedisCluster(config).pipe(Effect.provide(seed.layer))),
    );
    yield* sent(seed, ["CLUSTER", "SHARDS"], "-NOPERM missing permission\r\n");

    expect(yield* Fiber.join(opening)).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ServerError", code: "NOPERM" },
    });
    expect(yield* seed.written).toHaveLength(1);
    expect((yield* seed.observations).closed).toBe(1);
  }),
);

it.effect("retains the last complete snapshot after malformed discovery", () =>
  Effect.gen(function* () {
    const { client, seed, a } = yield* clusterControlled();
    const before = yield* client.topology;
    const refresh = yield* Effect.forkChild(Effect.result(client.refresh));
    yield* sent(seed, ["CLUSTER", "SLOTS"], "*0\r\n");
    yield* sent(a, ["CLUSTER", "SLOTS"], "*0\r\n");
    expect(yield* Fiber.join(refresh)).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ClusterError", reason: "invalid-topology" },
    });

    expect((yield* client.topology).revision).toBe(before.revision);
    expect(yield* client.snapshot).toMatchObject({ refreshFailures: 1 });
  }),
);

it.effect("bounds direct refresh waiters and recovers their capacity", () =>
  Effect.gen(function* () {
    const { client, seed } = yield* clusterControlled({ maxOperations: 1 });
    const refresh = yield* Effect.forkChild(client.refresh);
    yield* sent(seed, ["CLUSTER", "SLOTS"]);
    expect(yield* Effect.flip(client.refresh)).toMatchObject({
      reason: "capacity",
      delivery: "unsent",
    });
    yield* seed.receive(bytes(slotReply()));
    yield* Fiber.join(refresh);

    const next = yield* Effect.forkChild(client.refresh);
    yield* sent(seed, ["CLUSTER", "SLOTS"], slotReply());
    yield* Fiber.join(next);
  }),
);

it.effect("owns periodic refresh in the client scope and stops it on close", () =>
  Effect.gen(function* () {
    const { client, seed } = yield* clusterControlled({ refreshIntervalMillis: 100 });
    yield* TestClock.adjust(100);
    yield* sent(seed, ["CLUSTER", "SLOTS"], slotReply());
    yield* client.close;
    yield* TestClock.adjust(500);

    expect(yield* seed.written).toHaveLength(2);
    expect(yield* client.snapshot).toMatchObject({ closed: true });
  }),
);
