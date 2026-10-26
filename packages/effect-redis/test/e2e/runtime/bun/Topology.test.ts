import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Redacted } from "effect";

import { keySlot } from "#/index";
import { clusterFixture } from "#test/support/cluster/Fixture";
import { runtimeBarrier } from "#test/support/runtime/bun/Barrier";
import { runtimeConfig } from "#test/support/runtime/bun/Config";
import { runBun } from "#test/support/runtime/bun/Process";
import { bunCases } from "#test/support/runtime/bun/Targets";
import { awaitSentinel, sentinelFixture } from "#test/support/sentinel/Fixture";
import { recordFixture } from "#test/support/servers/Evidence";
import { FixtureError } from "#test/support/servers/FixtureError";
import { certificates } from "#test/support/tls/Certificates";

it.live.each(bunCases)(
  "BUN-CLUSTER: $target.fixture $protocol verified TLS, ASK/MOVED, sessions and events",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const fixture = yield* clusterFixture(target, protocol, { tls: yield* certificates() });
      yield* fixture.client.close;
      const [source, destination] = fixture.nodes;
      if (source === undefined || destination === undefined)
        return yield* Effect.die("Missing Cluster fixture node");
      const barrier = yield* runtimeBarrier(2);
      const running = yield* runBun(
        {
          scenario: "cluster",
          config: runtimeConfig(fixture.config),
          addresses: [
            { host: source.address, port: source.port },
            ...fixture.nodes.slice(1).map((node) => ({ host: node.address, port: node.port })),
          ],
          barrier: barrier.url,
        },
        90_000,
      ).pipe(Effect.forkChild);

      yield* Effect.race(barrier.arrived(0), Fiber.join(running));
      const slot = String(keySlot("bun:counter{bar}"));
      yield* destination.request(["CLUSTER", "SETSLOT", slot, "IMPORTING", source.id]);
      yield* source.request(["CLUSTER", "SETSLOT", slot, "MIGRATING", destination.id]);
      yield* source.request([
        "MIGRATE",
        destination.address,
        "6379",
        "bun:counter{bar}",
        "0",
        "5000",
      ]);
      yield* barrier.release(0);

      yield* Effect.race(barrier.arrived(1), Fiber.join(running));
      for (const node of fixture.nodes.slice(0, 3))
        yield* node.request(["CLUSTER", "SETSLOT", slot, "NODE", destination.id]);
      yield* barrier.release(1);
      const receipt = yield* Fiber.join(running);

      expect(receipt.checks).toContain("ASK");
      expect(receipt.checks).toContain("MOVED");
      yield* recordFixture(`bun-cluster-${target.fixture}-${protocol}`, {
        ...receipt,
        builds: fixture.nodes.map((node) => node.build),
        configurations: fixture.nodes.map((node) => node.configurationDigest),
      });
    }),
  120_000,
);

it.live.each(bunCases)(
  "BUN-SENTINEL: $target.fixture $protocol separate auth/TLS and actual primary promotion",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const identity = yield* certificates();
      const fixture = yield* sentinelFixture(target, protocol, { auth: true, tls: identity });
      yield* fixture.client.close;
      const primary = fixture.servers[0];
      const oracle = fixture.servers[3];
      if (primary === undefined || oracle === undefined)
        return yield* Effect.die("Missing Sentinel fixture node");
      const { endpoint: _endpoint, ...data } = runtimeConfig(fixture.config.data);
      const barrier = yield* runtimeBarrier(1);
      const running = yield* runBun(
        {
          scenario: "sentinel",
          config: {
            serviceName: fixture.config.serviceName,
            sentinels: fixture.config.sentinels.map(runtimeConfig),
            data,
          },
          addresses: [
            { host: primary.address, port: primary.port },
            ...fixture.servers.slice(1).map((node) => ({ host: node.address, port: node.port })),
          ],
          barrier: barrier.url,
          tls: {
            ca: identity.ca,
            certificate: identity.clientCertificate,
            privateKey: Redacted.value(identity.clientKey),
          },
        },
        90_000,
      ).pipe(Effect.forkChild);

      yield* Effect.race(barrier.arrived(0), Fiber.join(running));
      yield* fixture.control(0, "kill");
      yield* awaitSentinel(
        oracle.request(["SENTINEL", "GET-MASTER-ADDR-BY-NAME", "cache"]).pipe(
          Effect.flatMap((reply) => {
            const host = reply._tag === "Array" ? reply.values[0] : undefined;
            return host?._tag === "BlobString" &&
              new TextDecoder().decode(host.value) !== primary.address
              ? Effect.void
              : Effect.fail(new FixtureError({ stage: "bun-promotion-pending" }));
          }),
        ),
      );
      yield* barrier.release(0);
      const receipt = yield* Fiber.join(running);

      expect(receipt.checks).toContain("actual-promotion");
      expect(receipt.checks).toContain("old-lease-rejected");
      yield* recordFixture(`bun-sentinel-${target.fixture}-${protocol}`, {
        ...receipt,
        builds: fixture.servers.map((node) => node.build),
        configurations: fixture.servers.map((node) => node.configurationDigest),
      });
    }),
  120_000,
);
