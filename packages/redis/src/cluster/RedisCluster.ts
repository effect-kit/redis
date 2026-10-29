import { Cause, Context, Effect, Exit, Layer, Stream } from "effect";

import { makeRedisAdmin } from "#/admin/RedisAdmin";
import { makeClusterEvents } from "#/cluster/events/Features";
import { makeNodeRegistry } from "#/cluster/nodes/Registry";
import { decodeClusterPolicy } from "#/cluster/Options";
import type { ClusterOptions } from "#/cluster/Options";
import { makeClusterRouter } from "#/cluster/routing/Router";
import { makeClusterScripts } from "#/cluster/scripting/Scripts";
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
import { clusterScan } from "#/commands/cluster/Scan";
import type { ClusterScanOptions } from "#/commands/cluster/Scan";
import type { KeyScanOptions } from "#/commands/scan/Build";
import { blockingStreamFamily } from "#/commands/streams/ReadFamily";
import { decodePolicy } from "#/connection/Options";
import { ClusterError } from "#/errors/ClusterError";
import { RedisConfigError } from "#/errors/RedisConfigError";
import { scanEntries } from "#/iteration/Pages";
import { makeRedis, Redis, scopedRedis } from "#/Redis";
import type { RedisConfig } from "#/RedisConfig";
import type { ScriptOptions } from "#/scripting/RedisScripts";
import type { AnyCommand } from "#/sessions/batch/Types";
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
  const events = yield* makeClusterEvents(registry, discovery, policy, options, config.database);
  yield* Effect.addFinalizer(() => events.close);
  const executor = router.executor();
  const redis = { ...(yield* scopedRedis(executor, batches)), ...batches };

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
        const unchanged = Effect.suspend(() =>
          discovery.current()?.revision === revision
            ? Effect.void
            : Effect.fail(new ClusterError({ reason: "topology-changed", delivery: "replied" })),
        );
        return Stream.fromIterable(new Set(initial.shards.map((shard) => shard.primary.id))).pipe(
          Stream.flatMap((node) =>
            scanEntries((cursor) =>
              unchanged.pipe(
                Effect.andThen(makeRedis(router.executor(node)).scan(cursor, scanOptions)),
                Effect.tap(() => unchanged),
              ),
            ),
          ),
        );
      }),
    );

  yield* discovery.refresh.pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? registry.close : Effect.void)),
  );
  yield* Effect.forkIn(
    Effect.forever(
      Effect.sleep(policy.refreshIntervalMillis).pipe(
        Effect.andThen(Effect.result(discovery.refresh)),
      ),
    ).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit) && Cause.hasDies(exit.cause))
            registry.poison(Cause.fromReasons(exit.cause.reasons.filter(Cause.isDieReason)));
        }),
      ),
    ),
    registry.scope,
  );

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
      makeClusterScripts(router, target, scriptOptions),
    streams: (target: ClusterTarget) => makeRedisStreams(redis, bound(target)),
    admin: (node: string) => makeRedisAdmin(bound({ node })),
    node: (node: string) => {
      const nodeBatches = {
        pipeline: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
          leases.withSession({ node }, (session) => session.pipeline(commands)),
        transaction: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
          leases.withSession({ node }, (session) => session.transaction(commands)),
      };
      return { ...makeRedis(router.executor(node), nodeBatches), ...nodeBatches };
    },
    /** Lazy, sequential node results; no broadcast atomicity or implicit retry. */
    onPrimaries: <A, E, RD, RE>(command: Command<A, E, RD, RE>) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const prepared = yield* command.prepare;
          const topology = yield* discovery.ensure;
          return Stream.fromIterable(
            new Set(topology.shards.map((shard) => shard.primary.id)),
          ).pipe(
            Stream.mapEffect((node) =>
              Effect.result(router.executor(node).executePrepared(prepared)).pipe(
                Effect.map((result) => ({ node, result })),
              ),
            ),
          );
        }),
      ),
    pubsub: events.pubsub,
    tracking: events.tracking,
    clusterScan: (cursor = "0", scanOptions?: ClusterScanOptions) =>
      executor.execute(clusterScan(cursor, scanOptions)),
    scanCluster: (scanOptions?: ClusterScanOptions) =>
      scanEntries((cursor) => executor.execute(clusterScan(cursor, scanOptions))),
    scanKeys,
    refresh: discovery.refresh,
    topology: discovery.ensure,
    snapshot: Effect.gen(function* () {
      return {
        ...(yield* registry.snapshot),
        ...router.admission.snapshot(),
        ...events.snapshot(),
        revision: discovery.current()?.revision ?? 0,
        refreshFailures: discovery.failures(),
      };
    }),
    close: events.close.pipe(Effect.ensuring(registry.close)),
  };
});

export type RedisClusterClient = Effect.Success<ReturnType<typeof makeRedisCluster>>;

export class RedisCluster extends Context.Service<RedisCluster, RedisClusterClient>()(
  "@effect-kit/redis/RedisCluster",
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
