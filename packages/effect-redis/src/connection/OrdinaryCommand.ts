import { AdmissionError } from "#/errors/AdmissionError";
import type { RedisCommand } from "#/protocol/encode";

const modes = new Set([
  "DEBUG",
  "AUTH",
  "HELLO",
  "SELECT",
  "WATCH",
  "UNWATCH",
  "MULTI",
  "EXEC",
  "DISCARD",
  "SUBSCRIBE",
  "PSUBSCRIBE",
  "SSUBSCRIBE",
  "UNSUBSCRIBE",
  "PUNSUBSCRIBE",
  "SUNSUBSCRIBE",
  "MONITOR",
  "RESET",
  "QUIT",
  "SHUTDOWN",
  "SYNC",
  "PSYNC",
  "REPLCONF",
  "ASKING",
  "READONLY",
  "READWRITE",
  "WAIT",
  "WAITAOF",
  "BLPOP",
  "BRPOP",
  "BRPOPLPUSH",
  "BLMOVE",
  "BLMPOP",
  "BZPOPMIN",
  "BZPOPMAX",
  "BZMPOP",
]);

const token = (value: string | Uint8Array | undefined) =>
  typeof value === "string"
    ? value.length <= 64
      ? value.toUpperCase()
      : ""
    : value instanceof Uint8Array
      ? value.length <= 64
        ? new TextDecoder().decode(value).toUpperCase()
        : ""
      : "";

const blockingRead = (command: RedisCommand, group: boolean) => {
  let index = group ? 4 : 1;

  // After STREAMS, tokens are keys and IDs; a key named BLOCK must not change the mode.
  while (index < command.length) {
    const option = token(command[index]);
    if (option === "STREAMS") return false;
    if (option === "BLOCK") return true;

    index += option === "COUNT" ? 2 : 1;
  }

  return false;
};

/** The caller declares ordinary single-reply semantics; known session operations still fail closed. */
export const checkOrdinary = (command: RedisCommand) => {
  if (!Array.isArray(command) || command.length === 0) return undefined;

  const name = token(command[0]);
  const subcommand = token(command[1]);

  if (
    modes.has(name) ||
    (name === "SCRIPT" && subcommand === "DEBUG") ||
    (name === "CLIENT" &&
      !["ID", "INFO", "LIST", "GETNAME", "GETREDIR", "HELP"].includes(subcommand)) ||
    ((name === "XREAD" || name === "XREADGROUP") && blockingRead(command, name === "XREADGROUP"))
  )
    return new AdmissionError({ reason: "session-required", delivery: "unsent" });

  return undefined;
};
