import { Context, Effect, Layer } from "effect";

import { BatchExecutor } from "#/command/BatchExecutor";
import type { RedisExecutor } from "#/command/Executor";
import { blockingFamily } from "#/commands/blocking/Family";
import { blockingStreamFamily } from "#/commands/streams/ReadFamily";
import { SessionError } from "#/errors/SessionError";
import type { RedisArgument } from "#/RedisArgument";
import type { RedisConfig } from "#/RedisConfig";
import { runPipeline } from "#/sessions/batch/Pipeline";
import { prepareBatch } from "#/sessions/batch/Prepare";
import type { AnyCommand, BatchExecutorService, BatchResults } from "#/sessions/batch/Types";
import { makeLeasePool } from "#/sessions/pool/LeasePool";
import { decodeSessionPolicy } from "#/sessions/pool/Options";
import type { SessionOptions } from "#/sessions/pool/Options";
import { makeSession } from "#/sessions/Session";
import type { RedisSession } from "#/sessions/Session";

export const makeRedisSessions = Effect.fnUntraced(function* <R = never>(
  config: RedisConfig,
  options: SessionOptions<R> = {},
) {
  const { connection, ...policyInput } = options;
  const policy = yield* decodeSessionPolicy(policyInput);
  const pool = yield* makeLeasePool(config, policy, connection ?? {});

  const withSession = <A, E, RUse>(body: (session: RedisSession) => Effect.Effect<A, E, RUse>) =>
    pool.use("session", (wire) => {
      const session = makeSession(wire, policy);
      return Effect.suspend(() => body(session.client)).pipe(Effect.onExit(() => session.finish));
    });

  const withBlockingSession = <A, E, RUse>(
    body: (session: RedisSession) => Effect.Effect<A, E, RUse>,
  ) =>
    pool.use("blocking", (wire) => {
      const session = makeSession(wire, policy);
      return Effect.suspend(() => body(session.client)).pipe(Effect.onExit(() => session.finish));
    });

  const batches: BatchExecutorService = {
    pipeline: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      prepareBatch(commands, policy.maxBatchCommands).pipe(
        Effect.flatMap((prepared) =>
          prepared.length === 0
            ? Effect.succeed([] as BatchResults<Cs>)
            : pool.use("session", (wire) => runPipeline<Cs>(wire, prepared)),
        ),
      ),
    transaction: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      prepareBatch(commands, policy.maxBatchCommands).pipe(
        Effect.flatMap((prepared) =>
          pool.use("session", (wire) => {
            const session = makeSession(wire, policy);
            return session
              .transactionPrepared<Cs>(prepared)
              .pipe(Effect.onExit(() => session.finish));
          }),
        ),
      ),
  };

  const blockingExecutor: RedisExecutor = {
    execute: (command) =>
      command.prepare.pipe(
        Effect.flatMap((prepared) => blockingExecutor.executePrepared(prepared)),
      ),
    executePrepared: (prepared) =>
      prepared.metadata.execution !== "blocking"
        ? Effect.fail(new SessionError({ reason: "execution-mode", delivery: "unsent" }))
        : pool.use("blocking", (wire) => {
            const session = makeSession(wire, policy);
            return session.client
              .executePrepared(prepared)
              .pipe(Effect.onExit(() => session.finish));
          }),
  };

  return {
    ...blockingFamily(blockingExecutor),
    ...blockingStreamFamily(blockingExecutor),
    executeBlocking: blockingExecutor.execute,
    ...batches,
    withSession,
    withBlockingSession,
    watch: <A, E, RUse>(
      keys: readonly [RedisArgument, ...RedisArgument[]],
      body: (session: RedisSession) => Effect.Effect<A, E, RUse>,
    ) =>
      withSession((session) =>
        session.watch(keys).pipe(Effect.andThen(Effect.suspend(() => body(session)))),
      ),
    snapshot: pool.snapshot,
    close: pool.close,
  };
});

export type RedisSessionsClient = Effect.Success<ReturnType<typeof makeRedisSessions>>;

export class RedisSessions extends Context.Service<RedisSessions, RedisSessionsClient>()(
  "@envoy1084/effect-redis/RedisSessions",
) {
  static layer<R = never>(config: RedisConfig, options?: SessionOptions<R>) {
    const sessions = Layer.effect(RedisSessions, makeRedisSessions(config, options));
    return Layer.effect(
      BatchExecutor,
      RedisSessions.pipe(
        Effect.map((service) => ({
          pipeline: service.pipeline,
          transaction: service.transaction,
        })),
      ),
    ).pipe(Layer.provideMerge(sessions));
  }
}
