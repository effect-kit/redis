import { expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { makeNodeRegistry } from "#/cluster/nodes/Registry";
import { decodeClusterPolicy } from "#/cluster/Options";
import { makeDiscovery } from "#/cluster/topology/Discovery";
import { decodeRedisConfig } from "#/RedisConfig";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

it.effect("topology invalidation finishes every cohort before propagating cleanup defects", () =>
  Effect.gen(function* () {
    const transport = yield* makeControlledTransport();
    const config = yield* decodeRedisConfig({ endpoint: { host: "seed" } });
    const policy = yield* decodeClusterPolicy({});
    const registry = yield* makeNodeRegistry<never>(config, policy, {}).pipe(
      Effect.provide(transport.layer),
    );
    const discovery = makeDiscovery(registry, [{ host: "seed", port: 6379 }], policy, false);
    let closed = false;
    yield* discovery.observe(Effect.die("cohort-cleanup-defect"));
    yield* discovery.observe(
      Effect.sync(() => {
        closed = true;
      }),
    );

    const result = yield* Effect.exit(discovery.invalidate);

    expect(Exit.hasDies(result)).toBe(true);
    expect(closed).toBe(true);
    expect((yield* transport.observations).acquired).toBe(0);
  }),
);
