import { Context, Effect, Layer, Stream } from "effect";

import { makeRedisAdmin } from "#/admin/RedisAdmin";
import { makeNodeRegistry } from "#/cluster/nodes/Registry";
import { decodeClusterPolicy } from "#/cluster/Options";
import type { ClusterOptions } from "#/cluster/Options";
import { makeClusterRouter } from "#/cluster/routing/Router";
import { makeClusterBatches } from "#/cluster/sessions/Batches";
import { makeClusterSessions } from "#/cluster/sessions/Sessions";
import type { ClusterTarget } from "#/cluster/sessions/Sessions";
import { decodeAddress } from "#/cluster/topology/Decode";
import { makeDiscovery } from "#/cluster/topology/Discovery";
import { BatchExecutor } from "#/command/BatchExecutor";
import type { Command, PreparedCommand } from "#/command/Command";
import { decodeReply } from "#/command/Decode";
import { CommandExecutor } from "#/command/Executor";
import { blockingFamily } from "#/commands/blocking/Family";
import type { KeyScanOptions } from "#/commands/scan/Build";
import { blockingStreamFamily } from "#/commands/streams/ReadFamily";
import { decodePolicy } from "#/connection/Options";
import { ClusterError } from "#/errors/ClusterError";
import { RedisConfigError } from "#/errors/RedisConfigError";
import { makeRedis, Redis } from "#/Redis";
import type { RedisConfig } from "#/RedisConfig";
import { makeRedisScripts } from "#/scripting/RedisScripts";
import type { ScriptOptions } from "#/scripting/RedisScripts";
import { makeRedisStreams } from "#/streams/RedisStreams";

/** Native client-side Cluster routing; proxy endpoints retain standalone execution. */
export const makeRedisCluster = Effect.fnUntraced(function* <R = never>(
  config: RedisConfig,
  options: ClusterOptions<R> = {},
) {
  const {
    seeds: inputSeeds = [],
    addressMap: _addressMap,
    connection,
    sessions: _sessions,
    ...input
  } = options;
  const policy = yield* decodeClusterPolicy(input);
  const { credentials: _credentials, ...connectionPolicy } = connection ?? {};
  yield* decodePolicy(connectionPolicy);
  if (config.endpoint._tag !== "Tcp")
    return yield* new RedisConfigError({
      field: "cluster.endpoint",
      reason: "Cluster requires TCP endpoints",
    });
  if (config.database !== 0 && policy.databaseCapability === "db0")
    return yield* new ClusterError({ reason: "database", delivery: "unsent" });
  if (config.credentials !== undefined && connection?.credentials !== undefined)
    return yield* new RedisConfigError({
      field: "connection.credentials",
      reason: "Choose fixed credentials or an Effect credential source",
    });
  if (inputSeeds.length + 1 > policy.maxNodes)
    return yield* new ClusterError({ reason: "capacity", delivery: "unsent" });

  const seeds = yield* Effect.forEach(
    [{ host: config.endpoint.host, port: config.endpoint.port }, ...inputSeeds],
    decodeAddress,
  );
  const registry = yield* makeNodeRegistry(config, policy, options);
  const discovery = makeDiscovery(registry, seeds, policy, config.endpoint.tls !== undefined);
  const router = makeClusterRouter(config, registry, discovery, policy);
  const leases = makeClusterSessions(registry, discovery, router, config.database);
  const batches = makeClusterBatches(leases, router, registry.sessionPolicy);
  const executor = router.executor();
  const redis = { ...makeRedis(executor), ...batches };
  let closed = false;

  const executeBlocking = <A, E, RD, RE>(command: Command<A, E, RD, RE>) =>
    command.prepare.pipe(
      Effect.flatMap((prepared) =>
        router
          .reply(prepared, undefined, true)
          .pipe(Effect.flatMap((reply) => decodeReply(prepared, reply))),
      ),
    );
  const blocking = {
    execute: executeBlocking,
    executePrepared: <A, E, RD>(prepared: PreparedCommand<A, E, RD>) =>
      router
        .reply(prepared, undefined, true)
        .pipe(Effect.flatMap((reply) => decodeReply(prepared, reply))),
  };

  const bound = (target: ClusterTarget) => ({
    withSession: <A, E, RUse>(body: Parameters<typeof leases.withSession<A, E, RUse>>[1]) =>
      leases.withSession(target, body),
    withBlockingSession: <A, E, RUse>(
      body: Parameters<typeof leases.withBlockingSession<A, E, RUse>>[1],
    ) => leases.withBlockingSession(target, body),
  });

  const scanKeys = (scanOptions: KeyScanOptions = {}) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const initial = yield* discovery.ensure;
        const revision = initial.revision;
        // A finite node traversal is not a snapshot; changes are surfaced rather than silently missing a new primary.
        return Stream.fromIterable(initial.shards.map((shard) => shard.primary.id)).pipe(
          Stream.flatMap((node) =>
            makeRedis(router.executor(node))
              .scanKeys(scanOptions)
              .pipe(
                Stream.mapEffect((key) => {
                  const current = discovery.current();
                  return current?.revision === revision
                    ? Effect.succeed(key)
                    : Effect.fail(
                        new ClusterError({ reason: "topology-changed", delivery: "replied" }),
                      );
                }),
              ),
          ),
        );
      }),
    );

  yield* discovery.refresh;

  return {
    redis,
    executor,
    ...batches,
    ...blockingFamily(blocking),
    ...blockingStreamFamily(blocking),
    executeBlocking,
    withSession: leases.withSession,
    withBlockingSession: leases.withBlockingSession,
    scripts: (target: ClusterTarget, scriptOptions?: ScriptOptions) =>
      makeRedisScripts(bound(target), scriptOptions),
    streams: (target: ClusterTarget) => makeRedisStreams(redis, bound(target)),
    admin: (node: string) => makeRedisAdmin(bound({ node })),
    node: (node: string) => makeRedis(router.executor(node)),
    scanKeys,
    refresh: discovery.refresh,
    topology: discovery.ensure,
    snapshot: Effect.gen(function* () {
      return {
        ...(yield* registry.snapshot),
        ...router.admission.snapshot(),
        revision: discovery.current()?.revision ?? 0,
        refreshFailures: discovery.failures(),
        closed,
      };
    }),
    close: Effect.suspend(() => {
      closed = true;
      return registry.close;
    }),
  };
});

export type RedisClusterClient = Effect.Success<ReturnType<typeof makeRedisCluster>>;

export class RedisCluster extends Context.Service<RedisCluster, RedisClusterClient>()(
  "@envoy1084/effect-redis/RedisCluster",
) {
  static layer<R = never>(config: RedisConfig, options?: ClusterOptions<R>) {
    const cluster = Layer.effect(RedisCluster, makeRedisCluster(config, options));
    return Layer.mergeAll(
      Layer.effect(CommandExecutor, RedisCluster.pipe(Effect.map((client) => client.executor))),
      Layer.effect(
        BatchExecutor,
        RedisCluster.pipe(
          Effect.map((client) => ({ pipeline: client.pipeline, transaction: client.transaction })),
        ),
      ),
      Layer.effect(Redis, RedisCluster.pipe(Effect.map((client) => client.redis))),
    ).pipe(Layer.provideMerge(cluster));
  }
}
