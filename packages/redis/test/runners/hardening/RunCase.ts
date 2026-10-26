import { randomUUID } from "node:crypto";

import { Effect, Redacted, Schema } from "effect";

import { getContainerRuntimeClient } from "testcontainers";

import { decodeRedisConfig } from "#/RedisConfig";
import { Input, Receipt } from "#test/support/hardening/Contract";
import { runtimeConfig } from "#test/support/runtime/bun/Config";
import { runRuntimeProgram } from "#test/support/runtime/ChildProgram";
import { containerRequest } from "#test/support/servers/Containers";
import { allocateServer } from "#test/support/servers/DockerServer";
import type { ServerTarget } from "#test/support/servers/Targets";
import { certificates } from "#test/support/tls/Certificates";
import { upstashFixture } from "#test/support/upstash/Fixture";

export const runCase = Effect.fnUntraced(function* (options: {
  readonly target: ServerTarget;
  readonly runtime: "node" | "bun";
  readonly transport: "tcp" | "tls" | "http";
  readonly mode: Input["mode"];
  readonly soakMillis: number;
  readonly windows: number;
  readonly windowMillis: number;
}) {
  const target = options.target;
  const tls = options.transport === "tls" ? yield* certificates() : undefined;
  const http = options.transport === "http" ? yield* upstashFixture(target) : undefined;
  const server =
    http === undefined
      ? yield* (yield* allocateServer(target, tls === undefined ? undefined : { tls })).start
      : undefined;
  const config =
    http === undefined
      ? yield* decodeRedisConfig({
          endpoint: {
            host: "127.0.0.1",
            port: server?.port,
            ...(tls === undefined
              ? {}
              : {
                  tls: {
                    serverName: "redis.test",
                    ca: tls.ca,
                    certificate: tls.clientCertificate,
                    privateKey: Redacted.value(tls.clientKey),
                  },
                }),
          },
          protocol: "resp3",
          commandTimeoutMillis: 15_000,
        })
      : http.nativeConfig;
  const input = {
    mode: options.mode,
    engine: target.product,
    transport: options.transport,
    config: runtimeConfig(config),
    ...(http === undefined
      ? {}
      : { http: { url: http.input.url, token: Redacted.value(http.input.token) } }),
    prefix: `effect-kit:hardening:${randomUUID()}:`,
    windowMillis: options.windowMillis,
    windows: options.windows,
    soakMillis: options.soakMillis,
  };
  yield* Schema.decodeUnknownEffect(Input)(input);
  const client = yield* containerRequest("hardening-runtime", getContainerRuntimeClient);
  const name = server?.name ?? http?.names[0];
  if (name === undefined) return yield* Effect.die(new Error("Missing owned server identity"));
  const stats = () =>
    containerRequest("hardening-server-stats", () =>
      client.container.dockerode.getContainer(name).stats({ stream: false }),
    );
  const began = performance.now();
  const before = yield* stats();
  const output = yield* runRuntimeProgram({
    runtime: options.runtime,
    program: new URL("main.ts", import.meta.url),
    input: JSON.stringify(input),
    timeout: options.mode === "soak" ? options.soakMillis + 90_000 : 180_000,
    stage: "hardening-child",
    exposeGc: true,
    transformTypes: true,
  });
  const after = yield* stats();
  const receipt = yield* Schema.decodeUnknownEffect(Receipt)(JSON.parse(output));
  if (
    receipt.runtime !== options.runtime ||
    receipt.engine !== target.product ||
    receipt.transport !== options.transport
  )
    return yield* Effect.die(new Error("Hardening receipt identity mismatch"));
  return {
    ...receipt,
    server: {
      elapsedMillis: performance.now() - began,
      cpuMillis:
        (after.cpu_stats.cpu_usage.total_usage - before.cpu_stats.cpu_usage.total_usage) /
        1_000_000,
      memoryBytes: after.memory_stats.usage,
    },
    image: target.reference,
    build: (server ?? http)?.build,
    configurationDigest: (server ?? http)?.configurationDigest,
  };
});
