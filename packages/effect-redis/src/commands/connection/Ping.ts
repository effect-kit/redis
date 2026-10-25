import { defineCommand } from "../../command/Command.js";
import type { RedisExecutor } from "../../command/Executor.js";
import { status } from "../../command/reply/Scalars.js";
import { metadata } from "../Metadata.js";

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
