import { Context, Effect, Layer, Redacted } from "effect";

import type { Command, PreparedCommand } from "#/command/Command";
import { undecorate } from "#/command/reply/Scalars";
import type { ExecutionError } from "#/connection/Admission";
import { Connection } from "#/connection/Connection";
import type { RedisConnection } from "#/connection/Connection";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { ReplyError } from "#/errors/ReplyError";
import { ServerError } from "#/errors/ServerError";
import { UnsupportedCommandError } from "#/errors/UnsupportedCommandError";

export type RedisError =
  | ExecutionError
  | CommandInputError
  | ServerError
  | ReplyError
  | UnsupportedCommandError;

export interface RedisExecutor {
  readonly execute: <A, E, RD, RE>(
    command: Command<A, E, RD, RE>,
  ) => Effect.Effect<A, RedisError | E, RD | RE>;
  readonly executePrepared: <A, E, R>(
    command: PreparedCommand<A, E, R>,
  ) => Effect.Effect<A, RedisError | E, R>;
}

// Only the bounded error code is public; server text can contain echoed keys or values.
const serverCode = (bytes: Uint8Array) => {
  let code = "";

  for (const byte of bytes.subarray(0, 65)) {
    if (byte === 32) return code.length > 0 ? code : "ERR";
    if (
      !((byte >= 65 && byte <= 90) || (byte >= 48 && byte <= 57) || byte === 95) ||
      code.length === 64
    )
      return "ERR";

    code += String.fromCharCode(byte);
  }

  return code || "ERR";
};

export const makeExecutor = (connection: RedisConnection): RedisExecutor => {
  const executePrepared = Effect.fnUntraced(function* <A, E, R>(command: PreparedCommand<A, E, R>) {
    if (command.metadata.execution !== "ordinary")
      return yield* new UnsupportedCommandError({ delivery: "unsent", reason: "execution-mode" });

    if (command.routing._tag === "Node")
      return yield* new UnsupportedCommandError({ delivery: "unsent", reason: "explicit-node" });

    const reply = yield* connection.executeOrdinary(command.tokens);
    const value = undecorate(reply);

    if (
      command.serverErrors === "fail" &&
      (value._tag === "SimpleError" || value._tag === "BlobError")
    )
      return yield* new ServerError({
        delivery: "replied",
        code: serverCode(value.value),
        reply: Redacted.make(reply),
      });

    // A decoder failure follows a known reply, so it must not trigger wire replay.
    return yield* command.decode(reply);
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
