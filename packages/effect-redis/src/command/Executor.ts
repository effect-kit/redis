import { Context, Effect, Layer } from "effect";

import type { Command, PreparedCommand } from "#/command/Command";
import { decodeReply } from "#/command/Decode";
import type { ExecutionError } from "#/connection/Admission";
import { Connection } from "#/connection/Connection";
import type { RedisConnection } from "#/connection/Connection";
import type { ClusterError } from "#/errors/ClusterError";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { ReplyError } from "#/errors/ReplyError";
import type { ServerError } from "#/errors/ServerError";
import type { SessionError } from "#/errors/SessionError";
import { UnsupportedCommandError } from "#/errors/UnsupportedCommandError";

export type RedisError =
  | ExecutionError
  | CommandInputError
  | ServerError
  | ReplyError
  | SessionError
  | ClusterError
  | UnsupportedCommandError;

export interface RedisExecutor {
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

  return {
    executePrepared,
    execute: (command) => command.prepare.pipe(Effect.flatMap(executePrepared)),
  };
};

export class CommandExecutor extends Context.Service<CommandExecutor, RedisExecutor>()(
  "@envoy1084/effect-redis/CommandExecutor",
) {
  static readonly layer = Layer.effect(CommandExecutor, Connection.pipe(Effect.map(makeExecutor)));
}
