import { defineCommand } from "#/command/Command";
import type { RedisExecutor } from "#/command/Executor";
import { status } from "#/command/reply/Scalars";
import { echo, pingMessage } from "#/commands/connection/Echo";
import { metadata } from "#/commands/Metadata";
import type { RedisArgument } from "#/RedisArgument";

export const pingMetadata = metadata("PING", "connection", ["COMMAND-01"]);

export const ping = () =>
  defineCommand({
    metadata: pingMetadata,
    tokens: ["PING"],
    routing: { _tag: "Keyless" },
    decode: status("PONG"),
  });

export const connectionFamily = (executor: RedisExecutor) => ({
  ping: () => executor.execute(ping()),
  echo: (value: RedisArgument) => executor.execute(echo(value)),
  pingMessage: (value: RedisArgument) => executor.execute(pingMessage(value)),
});
