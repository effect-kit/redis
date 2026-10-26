import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";

import { moduleBackend, moduleCases } from "#test/support/modules/Backend";
import { runtimeConfig } from "#test/support/runtime/bun/Config";
import { runBunContainer } from "#test/support/runtime/bun/Container";
import { ModuleProfile } from "#test/support/runtime/bun/Input";
import { bunTargets } from "#test/support/runtime/bun/Targets";
import { allocateServer } from "#test/support/servers/DockerServer";
import { recordFixture } from "#test/support/servers/Evidence";
import { fixtureNetwork } from "#test/support/servers/Network";
import { certificates } from "#test/support/tls/Certificates";

it.live.each(bunTargets)(
  "BUN-LINUX: $fixture actual pinned Linux runtime verifies mutual TLS and application workflows",
  (target) =>
    Effect.gen(function* () {
      const identity = yield* certificates();
      const network = yield* fixtureNetwork;
      const password = randomUUID();
      const server = yield* (yield* allocateServer(target, {
        network,
        tls: identity,
        password: Redacted.make(password),
      })).start;
      if (server.networkAddress === undefined)
        return yield* Effect.die("Missing Linux server address");

      const config = {
        endpoint: {
          host: server.networkAddress,
          port: 6379,
          tls: {
            serverName: "localhost",
            ca: identity.ca,
            certificate: identity.clientCertificate,
            privateKey: Redacted.value(identity.clientKey),
          },
        },
        protocol: "resp3",
        credentials: { password },
      };
      const receipt = yield* runBunContainer(network, { scenario: "application", config });
      const budget = yield* runBunContainer(network, {
        scenario: "small-buffer",
        config: {
          ...config,
          protocol: "resp2",
          limits: { maxHeaderBytes: 32, maxBlobBytes: 64, maxBufferedBytes: 128 },
        },
      });

      expect(receipt.platform).toBe("linux");
      expect(receipt.checks).toContain("native-crypto");
      expect(receipt.checks).toContain("scoped-reader-cleanup");
      yield* recordFixture(`bun-linux-${target.fixture}`, {
        ...receipt,
        protocolBudget: budget,
        build: server.build,
        configurationDigest: server.configurationDigest,
      });
    }),
  60_000,
);

it.live.each(moduleCases.filter((testCase) => testCase.protocol === "resp3"))(
  "BUN-LINUX-MODULES: $fixture.id pinned runtime retains module reply contracts",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const network = yield* fixtureNetwork;
      const backend = yield* moduleBackend(fixture, protocol, { network });
      yield* backend.connection.close;
      const host = backend.server.networkAddress;
      if (host === undefined) return yield* Effect.die("Missing module network address");
      const profile = yield* Schema.decodeUnknownEffect(ModuleProfile)(fixture.id);

      const receipt = yield* runBunContainer(network, {
        scenario: "modules",
        profile,
        config: { ...runtimeConfig(backend.config), endpoint: { host, port: 6379 } },
      });

      expect(receipt.platform).toBe("linux");
      expect(receipt.checks).toContain("binary-vector-search");
      yield* recordFixture(`bun-linux-${fixture.id}`, {
        ...receipt,
        observed: backend.observed,
        build: backend.server.build,
        configurationDigest: backend.server.configurationDigest,
      });
    }),
  60_000,
);
