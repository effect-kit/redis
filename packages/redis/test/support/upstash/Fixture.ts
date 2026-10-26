import { randomUUID } from "node:crypto";

import { Effect, Redacted, Schedule } from "effect";

import { Wait } from "testcontainers";

import { decodeRedisConfig } from "#/RedisConfig";
import { FixtureContainer, requireImage, scopedContainer } from "#test/support/servers/Containers";
import { allocateServer } from "#test/support/servers/DockerServer";
import { FixtureError } from "#test/support/servers/FixtureError";
import { fixtureNetwork } from "#test/support/servers/Network";
import { selectedEngine, serverTargets } from "#test/support/servers/Targets";
import type { ServerTarget } from "#test/support/servers/Targets";
import { proxyFixture, proxyImage } from "#test/support/upstash/Manifest";

export const httpTargets = serverTargets.filter(
  (target) =>
    ["redis", "valkey"].includes(target.fixture) &&
    (selectedEngine === "all" || selectedEngine === target.product),
);

export const upstashFixture = Effect.fnUntraced(function* (target: ServerTarget) {
  yield* requireImage(proxyImage);
  const network = yield* fixtureNetwork;
  const server = yield* (yield* allocateServer(target, { network, networkAlias: "backend" })).start;
  const token = Redacted.make(randomUUID());

  const container = new FixtureContainer(proxyImage)
    .withEnvironment({
      UPREST_PORT: "8080",
      UPREST_TOKEN: Redacted.value(token),
      UPREST_CONNECTION_STRING: "redis://backend:6379",
      UPREST_MAX_CONNECTIONS: "16",
    })
    .withNetwork(network)
    .withWaitStrategy(Wait.forAll([]))
    .loopbackPort(8080);
  const started = yield* scopedContainer(container);
  const url = `http://127.0.0.1:${started.getMappedPort(8080)}`;

  yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${url}/ready`, {
        headers: { authorization: `Bearer ${Redacted.value(token)}` },
        signal: AbortSignal.timeout(1000),
      });
      await response.arrayBuffer();
      if (!response.ok) throw new Error("Proxy is not ready");
    },
    catch: (cause) =>
      new FixtureError({ stage: "http-proxy-readiness", cause: Redacted.make(cause) }),
  }).pipe(Effect.retry({ schedule: Schedule.spaced(100), times: 40 }));

  const nativeConfig = yield* decodeRedisConfig({
    endpoint: { host: "127.0.0.1", port: server.port },
    protocol: "resp2",
  });
  return {
    input: { url, token, allowInsecureLocalhost: true, pipelineResponseFormat: "frames" as const },
    nativeConfig,
    target,
    proxy: proxyFixture,
    build: server.build,
    configurationDigest: server.configurationDigest,
    names: [server.name, container.fixtureName],
  };
});
