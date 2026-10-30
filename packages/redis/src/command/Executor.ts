import { Context, Effect, Layer, Redacted } from "effect";

import type { Command, PreparedCommand } from "#/command/Command";
import { batchTokens } from "#/command/Compiled";
import { decodeReply } from "#/command/Decode";
import { registerValuesExecutor } from "#/command/ValuesExecutor";
import type { ExecutionError } from "#/connection/Admission";
import { Connection } from "#/connection/Connection";
import type { RedisConnection } from "#/connection/Connection";
import { BatchError } from "#/errors/BatchError";
import type { ClusterError } from "#/errors/ClusterError";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { ReplyError } from "#/errors/ReplyError";
import type { SentinelError } from "#/errors/SentinelError";
import type { ServerError } from "#/errors/ServerError";
import type { SessionError } from "#/errors/SessionError";
import { UnsupportedCommandError } from "#/errors/UnsupportedCommandError";
import type { UpstashError } from "#/errors/UpstashError";
import { decodeBatch } from "#/sessions/batch/Decode";
import { decodeBatchValues } from "#/sessions/batch/DecodeValues";
import { mapBatchFailure } from "#/sessions/batch/Failure";
import { validateOrdinary } from "#/sessions/batch/Prepare";
import type {
  AnyCommand,
  BatchFailure,
  BatchResults,
  DecodeRequirements,
  PreparedBatch,
  PartialBatchError,
} from "#/sessions/batch/Types";

export type RedisError =
  | ExecutionError
  | CommandInputError
  | ServerError
  | ReplyError
  | SessionError
  | ClusterError
  | SentinelError
  | UnsupportedCommandError
  | UpstashError;

export interface RedisExecutor {
  readonly executeBatchPrepared?: <const Cs extends ReadonlyArray<AnyCommand>>(
    prepared: PreparedBatch<Cs>,
  ) => Effect.Effect<BatchResults<Cs>, BatchFailure<Cs>, DecodeRequirements<Cs[number]>>;
  readonly execute: <A, E, RD, RE>(
    command: Command<A, E, RD, RE>,
  ) => Effect.Effect<A, RedisError | E, RD | RE>;
  readonly executePrepared: <A, E, R>(
    command: PreparedCommand<A, E, R>,
  ) => Effect.Effect<A, RedisError | E, R>;
}

export const makeExecutor = (connection: RedisConnection): RedisExecutor => {
  const executePrepared = Effect.fnUntraced(function* <A, E, R>(command: PreparedCommand<A, E, R>) {
    if (command.metadata.execution !== "ordinary")
      return yield* new UnsupportedCommandError({ delivery: "unsent", reason: "execution-mode" });

    if (command.routing._tag === "Node")
      return yield* new UnsupportedCommandError({ delivery: "unsent", reason: "explicit-node" });

    const reply = yield* connection.executeOrdinary(command.tokens);
    // A decoder failure follows a known reply, so it must not trigger wire replay.
    return yield* decodeReply(command, reply);
  });

  const exchangeBatch = <const Cs extends ReadonlyArray<AnyCommand>>(prepared: PreparedBatch<Cs>) =>
    mapBatchFailure(
      Effect.gen(function* () {
        if (prepared.length === 0) return [];
        for (const command of prepared) yield* validateOrdinary(command);
        if (connection.executeBatch === undefined)
          return yield* new UnsupportedCommandError({
            delivery: "unsent",
            reason: "execution-mode",
          });
        const replies = yield* mapBatchFailure(
          connection.executeBatch(batchTokens(prepared)),
          (error) =>
            (error instanceof BatchError
              ? error
              : new BatchError({
                  phase: "pipeline",
                  execution: "not-executed",
                  outcomes: Redacted.make(
                    prepared.map((_, index) => ({
                      _tag: "Unsent",
                      index,
                      error: Redacted.make(error),
                    })),
                  ),
                })) as PartialBatchError<Cs>,
        );
        return replies;
      }),
      (error) => error,
    );

  const executeBatchPrepared: NonNullable<RedisExecutor["executeBatchPrepared"]> = (prepared) =>
    mapBatchFailure(
      exchangeBatch(prepared).pipe(
        Effect.flatMap((replies) => decodeBatch(prepared, replies, "pipeline")),
      ),
      (error) => error,
    );

  const executor: RedisExecutor = {
    ...(connection.executeBatch === undefined ? {} : { executeBatchPrepared }),
    executePrepared,
    execute: (command) => command.prepare.pipe(Effect.flatMap(executePrepared)),
  };

  return connection.executeBatch === undefined
    ? executor
    : registerValuesExecutor(executor, (prepared) =>
        mapBatchFailure(
          exchangeBatch(prepared).pipe(
            Effect.flatMap((replies) => decodeBatchValues(prepared, replies)),
          ),
          (error) => error,
        ),
      );
};

export class CommandExecutor extends Context.Service<CommandExecutor, RedisExecutor>()(
  "@effect-kit/redis/CommandExecutor",
) {
  static readonly layer = Layer.effect(CommandExecutor, Connection.pipe(Effect.map(makeExecutor)));
}
