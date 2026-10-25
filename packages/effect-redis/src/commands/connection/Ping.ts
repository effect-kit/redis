import { defineCommand } from "#/command/Command";
import type { RedisExecutor } from "#/command/Executor";
import { status } from "#/command/reply/Scalars";
import { metadata } from "#/commands/Metadata";

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
});
