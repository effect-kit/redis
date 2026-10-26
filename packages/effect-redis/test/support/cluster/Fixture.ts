import { Effect, Redacted, Schedule } from "effect";

import { getContainerRuntimeClient } from "testcontainers";

import type { ClusterOptions } from "#/cluster/Options";
import { makeRedisCluster } from "#/cluster/RedisCluster";
import { checkServerReply } from "#/command/Decode";
import { simpleText } from "#/command/reply/Data";
import { connect, layer } from "#/node";
import type { RedisCommand } from "#/protocol/encode";
import { decodeRedisConfig } from "#/RedisConfig";
import { exchange } from "#test/support/networking/Exchange";
import { peerProxy } from "#test/support/networking/PeerProxy";
import { containerRequest, requireImage } from "#test/support/servers/Containers";
import { allocateServer } from "#test/support/servers/DockerServer";
import { FixtureError } from "#test/support/servers/FixtureError";
import { fixtureNetwork } from "#test/support/servers/Network";
import type { ServerTarget } from "#test/support/servers/Targets";
import type { Certificates } from "#test/support/tls/Certificates";

export const awaitCluster = <A, E, R>(check: Effect.Effect<A, E, R>) =>
  check.pipe(
    Effect.retry({ schedule: Schedule.spaced(50), times: 300 }),
    Effect.timeoutOrElse({
      duration: 20_000,
      orElse: () => Effect.fail(new FixtureError({ stage: "cluster-readiness" })),
    }),
  );

/** Six owned servers and their bus network; all host-facing ports remain loopback-only. */
export const clusterFixture = Effect.fnUntraced(function* (
  target: ServerTarget,
  protocol = "resp3",
  options: {
    readonly tls?: Certificates;
    readonly database?: number;
    readonly cluster?: ClusterOptions;
    readonly proxy?: boolean;
    readonly loadModules?: ReadonlyArray<string>;
  } = {},
) {
  if (protocol !== "resp2" && protocol !== "resp3")
    return yield* new FixtureError({ stage: "cluster-protocol" });
  yield* requireImage(target.reference);
  const network = yield* fixtureNetwork;
  const proxy = options.proxy ? yield* peerProxy(network) : undefined;
  const nodes = yield* Effect.forEach(
    [0, 1, 2, 3, 4, 5],
    (index) =>
      Effect.gen(function* () {
        const server = yield* (yield* allocateServer(target, {
          network,
          networkAlias: `node-${index}`,
          ...(options.tls === undefined ? {} : { tls: options.tls }),
          extraConfig: [
            ...(options.loadModules ?? []).map((path) => `loadmodule ${path}`),
            "cluster-enabled yes",
            "cluster-config-file nodes.conf",
            "cluster-node-timeout 1000",
            "cluster-require-full-coverage yes",
            "repl-diskless-sync-delay 0",
            ...((options.database ?? 0) === 0 ? [] : ["cluster-databases 16"]),
            ...(proxy === undefined
              ? []
              : [
                  `cluster-announce-ip ${proxy.address}`,
                  `cluster-announce-port ${7000 + index}`,
                  `cluster-announce-bus-port ${17000 + index}`,
                ]),
            ...(options.tls === undefined
              ? []
              : [
                  "tls-cluster yes",
                  "tls-replication yes",
                  "tls-client-cert-file /fixture/client.crt",
                  "tls-client-key-file /fixture/client.key",
                ]),
          ],
        })).start;
        const tls =
          options.tls === undefined
            ? undefined
            : {
                ca: options.tls.ca,
                certificate: options.tls.clientCertificate,
                privateKey: Redacted.value(options.tls.clientKey),
                serverName: "localhost",
              };
        const config = yield* decodeRedisConfig({
          endpoint: { host: "127.0.0.1", port: server.port, ...(tls === undefined ? {} : { tls }) },
          protocol: "resp2",
        });
        const oracle = yield* connect(config);
        const request = (tokens: RedisCommand) =>
          exchange(oracle, tokens).pipe(Effect.flatMap(checkServerReply));
        const id = yield* request(["CLUSTER", "MYID"]).pipe(Effect.flatMap(simpleText));
        const address = server.networkAddress;
        if (address === undefined) return yield* new FixtureError({ stage: "cluster-address" });
        return { ...server, config, request, id, address };
      }),
    { concurrency: 3 },
  );

  const first = nodes[0];
  if (first === undefined) return yield* new FixtureError({ stage: "cluster-seed" });
  for (const node of nodes.slice(1))
    yield* node.request(
      proxy === undefined
        ? ["CLUSTER", "MEET", first.address, "6379"]
        : ["CLUSTER", "MEET", proxy.address, "7000", "17000"],
    );
  for (const node of nodes)
    yield* awaitCluster(
      Effect.gen(function* () {
        const info = yield* node.request(["CLUSTER", "INFO"]).pipe(Effect.flatMap(simpleText));
        if (!info.includes("cluster_known_nodes:6"))
          return yield* new FixtureError({ stage: "cluster-membership" });
      }),
    );

  for (let index = 0; index < 3; index++) {
    const primary = nodes[index];
    const replica = nodes[index + 3];
    if (primary === undefined || replica === undefined)
      return yield* new FixtureError({ stage: "cluster-membership" });
    const start = Math.floor((index * 16384) / 3);
    const end = Math.floor(((index + 1) * 16384) / 3);
    yield* primary.request([
      "CLUSTER",
      "ADDSLOTS",
      ...Array.from({ length: end - start }, (_, offset) => String(start + offset)),
    ]);
    yield* replica.request(["CLUSTER", "REPLICATE", primary.id]);
  }
  for (const node of nodes)
    yield* awaitCluster(
      Effect.gen(function* () {
        const info = yield* node.request(["CLUSTER", "INFO"]).pipe(Effect.flatMap(simpleText));
        if (!info.includes("cluster_state:ok"))
          return yield* new FixtureError({ stage: "cluster-state" });
        if (nodes.indexOf(node) < 3) return;
        const replication = yield* node
          .request(["INFO", "replication"])
          .pipe(Effect.flatMap(simpleText));
        if (
          !replication.includes("master_link_status:up") ||
          !replication.includes("master_sync_in_progress:0")
        )
          return yield* new FixtureError({ stage: "cluster-replication" });
      }),
    );

  const database = options.database ?? 0;
  const config = {
    ...first.config,
    protocol,
    database,
    connectTimeoutMillis: 1000,
    commandTimeoutMillis: 5000,
  };
  const addressMap: NonNullable<ClusterOptions["addressMap"]> = (address) => {
    const node =
      proxy !== undefined && address.host === proxy.address
        ? nodes[address.port - 7000]
        : nodes.find((candidate) => candidate.address === address.host);
    return node === undefined
      ? address
      : { host: "127.0.0.1", port: node.port, serverName: "localhost" };
  };
  const client = yield* makeRedisCluster(config, {
    ...options.cluster,
    addressMap,
    ...(database === 0 ? {} : { databaseCapability: "valkey-multi-db" }),
  }).pipe(Effect.provide(layer));

  // Replica link readiness is local; the seed's advertised topology must also converge.
  yield* awaitCluster(
    Effect.gen(function* () {
      const topology = yield* client.refresh;
      if (
        topology.shards.length !== 3 ||
        topology.shards.some((shard) => shard.replicas.length !== 1)
      )
        return yield* new FixtureError({ stage: "cluster-replica-topology" });
    }),
  );

  return {
    client,
    nodes,
    config,
    addressMap,
    network,
    partition: (index: number) =>
      Effect.gen(function* () {
        const node = nodes[index];
        if (node === undefined) return yield* new FixtureError({ stage: "cluster-target" });
        if (proxy === undefined)
          return yield* new FixtureError({ stage: "cluster-proxy-required" });
        yield* Effect.acquireRelease(Effect.void, () => proxy.heal.pipe(Effect.orDie));
        yield* proxy.cut(index, node.address);
      }),
    control: (index: number, action: "kill" | "pause" | "unpause") =>
      Effect.gen(function* () {
        const node = nodes[index];
        if (node === undefined) return yield* new FixtureError({ stage: "cluster-target" });
        return yield* containerRequest("cluster-node-control", async () => {
          const runtime = await getContainerRuntimeClient();
          const container = runtime.container.dockerode.getContainer(node.name);
          await container[action]();
        });
      }),
  };
});
