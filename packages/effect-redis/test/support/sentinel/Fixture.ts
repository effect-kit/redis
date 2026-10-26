import { randomUUID } from "node:crypto";

import { Effect, Redacted, Schedule } from "effect";

import { getContainerRuntimeClient } from "testcontainers";

import { checkServerReply } from "#/command/Decode";
import { simpleText } from "#/command/reply/Data";
import { connect, layer } from "#/node";
import type { RedisCommand } from "#/protocol/encode";
import type { RespValue } from "#/protocol/RespValue";
import { decodeRedisConfig } from "#/RedisConfig";
import { decodeSentinelConfig } from "#/sentinel/Config";
import type { SentinelOptions } from "#/sentinel/Options";
import { makeRedisSentinel } from "#/sentinel/RedisSentinel";
import { exchange } from "#test/support/networking/Exchange";
import { peerProxy } from "#test/support/networking/PeerProxy";
import { containerRequest, requireImage } from "#test/support/servers/Containers";
import { allocateServer } from "#test/support/servers/DockerServer";
import { FixtureError } from "#test/support/servers/FixtureError";
import { fixtureNetwork } from "#test/support/servers/Network";
import type { ServerTarget } from "#test/support/servers/Targets";
import type { Certificates } from "#test/support/tls/Certificates";

export const awaitSentinel = <A, E, R>(check: Effect.Effect<A, E, R>) =>
  check.pipe(
    Effect.retry({ schedule: Schedule.spaced(50), times: 400 }),
    Effect.timeoutOrElse({
      duration: 25_000,
      orElse: () => Effect.fail(new FixtureError({ stage: "sentinel-readiness" })),
    }),
  );

/** Three data nodes and three voting Sentinels; all state and network ownership is disposable. */
export const sentinelFixture = Effect.fnUntraced(function* (
  target: ServerTarget,
  protocol: string = "resp3",
  options: {
    readonly auth?: boolean;
    readonly tls?: Certificates;
    readonly proxy?: boolean;
    readonly client?: SentinelOptions;
    readonly database?: number;
  } = {},
) {
  if (protocol !== "resp2" && protocol !== "resp3")
    return yield* new FixtureError({ stage: "sentinel-protocol" });
  yield* requireImage(target.reference);
  const network = yield* fixtureNetwork;
  const proxy = options.proxy ? yield* peerProxy(network) : undefined;
  const dataPassword = options.auth ? Redacted.make(randomUUID()) : undefined;
  const sentinelPassword = options.auth ? Redacted.make(randomUUID()) : undefined;
  const tls = options.tls;
  const tlsInput =
    tls === undefined
      ? undefined
      : {
          ca: tls.ca,
          certificate: tls.clientCertificate,
          privateKey: Redacted.value(tls.clientKey),
          serverName: "localhost",
        };

  const servers: Array<{
    readonly index: number;
    readonly name: string;
    readonly port: number;
    readonly address: string;
    readonly build: string;
    readonly configurationDigest: string;
    readonly request: (
      command: RedisCommand,
    ) => Effect.Effect<
      RespValue,
      Effect.Error<ReturnType<typeof exchange>> | Effect.Error<ReturnType<typeof checkServerReply>>
    >;
  }> = [];

  for (let index = 0; index < 6; index++) {
    const sentinel = index >= 3;
    const primary = servers[0];
    const monitoredHost = proxy?.address ?? primary?.address;
    const monitoredPort = proxy === undefined ? 6379 : 7000;
    const extraConfig = [
      ...(tls === undefined
        ? []
        : [
            "tls-replication yes",
            "tls-client-cert-file /fixture/client.crt",
            "tls-client-key-file /fixture/client.key",
          ]),
      ...(!sentinel
        ? [
            "repl-diskless-sync-delay 0",
            ...(proxy === undefined
              ? []
              : [`replica-announce-ip ${proxy.address}`, `replica-announce-port ${7000 + index}`]),
          ]
        : []),
      ...(index > 0 && !sentinel
        ? [
            `replicaof ${monitoredHost} ${monitoredPort}`,
            ...(dataPassword === undefined ? [] : [`masterauth ${Redacted.value(dataPassword)}`]),
          ]
        : []),
      ...(sentinel
        ? [
            `sentinel monitor cache ${monitoredHost} ${monitoredPort} 2`,
            "sentinel down-after-milliseconds cache 1000",
            "sentinel failover-timeout cache 5000",
            "sentinel parallel-syncs cache 1",
            ...(proxy === undefined
              ? []
              : [
                  `sentinel announce-ip ${proxy.address}`,
                  `sentinel announce-port ${7000 + index}`,
                ]),
            ...(dataPassword === undefined
              ? []
              : [`sentinel auth-pass cache ${Redacted.value(dataPassword)}`]),
            ...(sentinelPassword === undefined
              ? []
              : [`sentinel sentinel-pass ${Redacted.value(sentinelPassword)}`]),
          ]
        : []),
    ];
    const password = sentinel ? sentinelPassword : dataPassword;
    const server = yield* (yield* allocateServer(target, {
      network,
      networkAlias: `node-${index}`,
      extraConfig,
      ...(sentinel ? { sentinel: true, writableConfiguration: true } : {}),
      ...(tls === undefined ? {} : { tls }),
      ...(password === undefined ? {} : { password }),
    })).start;
    if (server.networkAddress === undefined)
      return yield* new FixtureError({ stage: "sentinel-address" });
    const config = yield* decodeRedisConfig({
      endpoint: {
        host: "127.0.0.1",
        port: server.port,
        ...(tlsInput === undefined ? {} : { tls: tlsInput }),
      },
      protocol: "resp2",
    });
    const oracle = yield* connect(config);
    const request = (tokens: RedisCommand) =>
      exchange(oracle, tokens).pipe(Effect.flatMap(checkServerReply));
    if (password !== undefined) yield* request(["AUTH", Redacted.value(password)]);
    servers.push({
      index,
      name: server.name,
      port: server.port,
      address: server.networkAddress,
      request,
      build: server.build,
      configurationDigest: server.configurationDigest,
    });
  }

  for (const server of servers.slice(1, 3))
    yield* awaitSentinel(
      Effect.gen(function* () {
        const info = yield* server
          .request(["INFO", "replication"])
          .pipe(Effect.flatMap(simpleText));
        if (!info.includes("master_link_status:up") || !info.includes("master_sync_in_progress:0"))
          return yield* new FixtureError({ stage: "sentinel-replication" });
      }),
    );
  for (const server of servers.slice(3))
    yield* awaitSentinel(server.request(["SENTINEL", "CKQUORUM", "cache"]));

  const endpoints = servers.slice(3).map((server) => {
    const endpoint =
      tlsInput === undefined
        ? { host: "127.0.0.1", port: server.port }
        : { host: "127.0.0.1", port: server.port, tls: tlsInput };
    return sentinelPassword === undefined
      ? { endpoint, protocol }
      : { endpoint, protocol, credentials: { password: Redacted.value(sentinelPassword) } };
  });
  const config = yield* decodeSentinelConfig({
    serviceName: "cache",
    sentinels: endpoints,
    data: {
      protocol,
      database: options.database ?? 0,
      connectTimeoutMillis: 1000,
      commandTimeoutMillis: 5000,
      ...(dataPassword === undefined
        ? {}
        : { credentials: { password: Redacted.value(dataPassword) } }),
    },
  });
  const addressMap: NonNullable<SentinelOptions["addressMap"]> = (address) => {
    const server =
      proxy !== undefined && address.host === proxy.address
        ? servers[address.port - 7000]
        : servers.find((candidate) => candidate.address === address.host);
    return server === undefined
      ? address
      : { host: "127.0.0.1", port: server.port, serverName: "localhost" };
  };
  const clientOptions: SentinelOptions = {
    addressMap,
    sentinelTimeoutMillis: 1000,
    ...(tls === undefined
      ? {}
      : {
          dataTls: {
            ca: Redacted.make(tls.ca),
            certificate: Redacted.make(tls.clientCertificate),
            privateKey: tls.clientKey,
            rejectUnauthorized: true,
          },
        }),
    ...options.client,
  };
  const client = yield* makeRedisSentinel(config, clientOptions).pipe(Effect.provide(layer));

  const control = (index: number, action: "kill" | "pause" | "unpause") =>
    Effect.gen(function* () {
      const server = servers[index];
      if (server === undefined) return yield* new FixtureError({ stage: "sentinel-target" });
      yield* containerRequest("sentinel-control", async () => {
        const runtime = await getContainerRuntimeClient();
        await runtime.container.dockerode.getContainer(server.name)[action]();
      });
    });

  return {
    client,
    config,
    clientOptions,
    servers,
    dataPassword,
    sentinelPassword,
    addressMap,
    control,
    partition: (index: number) =>
      Effect.gen(function* () {
        const server = servers[index];
        if (server === undefined || proxy === undefined)
          return yield* new FixtureError({ stage: "sentinel-proxy-required" });
        yield* Effect.acquireRelease(Effect.void, () => proxy.heal.pipe(Effect.orDie));
        yield* proxy.cut(index, server.address);
      }),
  };
});
