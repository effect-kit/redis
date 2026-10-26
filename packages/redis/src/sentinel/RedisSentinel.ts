import { Cause, Context, Effect, Exit, Layer, Schema } from "effect";

import { makeRedisAdmin } from "#/admin/RedisAdmin";
import { BatchExecutor } from "#/command/BatchExecutor";
import { CommandExecutor } from "#/command/Executor";
import { blockingFamily } from "#/commands/blocking/Family";
import { blockingStreamFamily } from "#/commands/streams/ReadFamily";
import { decode } from "#/config/Validation";
import { decodePolicy } from "#/connection/Options";
import { RedisConfigError } from "#/errors/RedisConfigError";
import { makeRedis, Redis } from "#/Redis";
import type { RedisArgument } from "#/RedisArgument";
import { makeRedisScripts } from "#/scripting/RedisScripts";
import type { ScriptOptions } from "#/scripting/RedisScripts";
import type { SentinelConfig } from "#/sentinel/Config";
import { makeSentinelControl } from "#/sentinel/Control";
import { makeSentinelEvents } from "#/sentinel/events/Features";
import { makeSentinelExecutor } from "#/sentinel/execution/Executor";
import { makeSentinelScans } from "#/sentinel/execution/Scans";
import { makeSentinelSessions } from "#/sentinel/execution/Sessions";
import { makeSentinelManager } from "#/sentinel/generation/Manager";
import { decodeSentinelPolicy } from "#/sentinel/Options";
import type { SentinelOptions } from "#/sentinel/Options";
import { prepareBatch } from "#/sessions/batch/Prepare";
import type { AnyCommand, BatchExecutorService } from "#/sessions/batch/Types";
import { makeRedisStreams } from "#/streams/RedisStreams";

export const makeRedisSentinel = Effect.fnUntraced(function* <RData = never, RSentinel = RData>(
  config: SentinelConfig,
  options: SentinelOptions<RData, RSentinel> = {},
) {
  const {
    connection,
    sentinelConnection,
    sessions: _sessions,
    addressMap: _addressMap,
    ...input
  } = options;
  const policy = yield* decodeSentinelPolicy(input);
  yield* decode(Schema.NonEmptyString, "sentinel.serviceName", config.serviceName);
  if (config.sentinels.length === 0 || config.sentinels.length > policy.maxSentinels)
    return yield* new RedisConfigError({
      field: "sentinel.sentinels",
      reason: "Invalid Sentinel endpoint count",
    });
  for (const endpoint of config.sentinels) {
    if (
      endpoint.endpoint._tag !== "Tcp" ||
      endpoint.database !== 0 ||
      (endpoint.credentials !== undefined && sentinelConnection?.credentials !== undefined)
    )
      return yield* new RedisConfigError({
        field: "sentinel.sentinels",
        reason: "Invalid discovery endpoint or credential combination",
      });
  }
  if (config.data.credentials !== undefined && connection?.credentials !== undefined)
    return yield* new RedisConfigError({
      field: "sentinel.data.credentials",
      reason: "Choose fixed credentials or an Effect credential source",
    });
  const { credentials: _dataCredentials, ...dataPolicy } = connection ?? {};
  const { credentials: _sentinelCredentials, ...sentinelPolicy } = sentinelConnection ?? {};
  yield* decodePolicy(dataPolicy);
  yield* decodePolicy(sentinelPolicy);

  const manager = yield* makeSentinelManager(config, policy, options);
  const leases = makeSentinelSessions(manager, config, policy);
  const executor = makeSentinelExecutor(leases, policy);
  const blocking = makeSentinelExecutor(leases, policy, true);
  const control = yield* makeSentinelControl(config.sentinels, policy, options, manager);
  const events = makeSentinelEvents(manager, options);
  const batches: BatchExecutorService = {
    pipeline: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      prepareBatch(commands, manager.sessionPolicy.maxBatchCommands).pipe(
        Effect.flatMap((prepared) =>
          leases.session("session", (session) => session.pipelinePrepared<Cs>(prepared)),
        ),
      ),
    transaction: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      prepareBatch(commands, manager.sessionPolicy.maxBatchCommands).pipe(
        Effect.flatMap((prepared) =>
          leases.session("session", (session) => session.transactionPrepared<Cs>(prepared)),
        ),
      ),
  };
  const scans = makeSentinelScans(manager, leases, policy);
  const redis = { ...makeRedis(executor), ...scans, ...batches };

  yield* manager.refresh.pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? manager.close : Effect.void)),
  );
  yield* Effect.forkIn(
    Effect.forever(
      Effect.sleep(policy.refreshIntervalMillis).pipe(
        Effect.andThen(Effect.result(manager.refresh)),
      ),
    ).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit) && Cause.hasDies(exit.cause))
            manager.poison(Cause.fromReasons(exit.cause.reasons.filter(Cause.isDieReason)));
        }),
      ),
    ),
    manager.scope,
  );

  return {
    redis,
    executor,
    ...batches,
    ...scans,
    ...blockingFamily(blocking),
    ...blockingStreamFamily(blocking),
    executeBlocking: blocking.execute,
    withSession: leases.withSession,
    withBlockingSession: leases.withBlockingSession,
    watch: <A, E, RUse>(
      keys: readonly [RedisArgument, ...RedisArgument[]],
      body: Parameters<typeof leases.withSession<A, E, RUse>>[0],
    ) =>
      leases.withSession((session) =>
        session.watch(keys).pipe(Effect.andThen(Effect.suspend(() => body(session)))),
      ),
    scripts: (scriptOptions?: ScriptOptions) => makeRedisScripts(leases, scriptOptions),
    streams: makeRedisStreams(redis, leases),
    admin: makeRedisAdmin(leases),
    sentinel: control,
    ...events,
    refresh: manager.refresh.pipe(Effect.map((generation) => generation.view)),
    topology: manager.ensure.pipe(Effect.map((generation) => generation.view)),
    snapshot: manager.snapshot.pipe(
      Effect.map((snapshot) => ({ ...snapshot, ...leases.admission.snapshot() })),
    ),
    close: manager.close,
  };
});

export type RedisSentinelClient = Effect.Success<ReturnType<typeof makeRedisSentinel>>;

export class RedisSentinel extends Context.Service<RedisSentinel, RedisSentinelClient>()(
  "@effect-kit/redis/RedisSentinel",
) {
  static layer<RData = never, RSentinel = RData>(
    config: SentinelConfig,
    options?: SentinelOptions<RData, RSentinel>,
  ) {
    const sentinel = Layer.effect(RedisSentinel, makeRedisSentinel(config, options));
    return Layer.mergeAll(
      Layer.effect(CommandExecutor, RedisSentinel.pipe(Effect.map((client) => client.executor))),
      Layer.effect(
        BatchExecutor,
        RedisSentinel.pipe(
          Effect.map((client) => ({ pipeline: client.pipeline, transaction: client.transaction })),
        ),
      ),
      Layer.effect(Redis, RedisSentinel.pipe(Effect.map((client) => client.redis))),
    ).pipe(Layer.provideMerge(sentinel));
  }
}
