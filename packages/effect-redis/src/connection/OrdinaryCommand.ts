import { AdmissionError } from "#/errors/AdmissionError";
import type { RedisCommand } from "#/protocol/encode";

const modes = new Set([
  "DEBUG",
  "HIMPORT",
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
  "BLMOVEM",
  "BLMPOP",
  "BZPOPMIN",
  "BZPOPMAX",
  "BZMPOP",
]);

export const commandToken = (value: string | Uint8Array | undefined) =>
  typeof value === "string"
    ? value.length <= 64
      ? value.toUpperCase()
      : ""
    : value instanceof Uint8Array
      ? value.length <= 64
        ? new TextDecoder().decode(value).toUpperCase()
        : ""
      : "";

export const blockingRead = (command: RedisCommand, group: boolean) => {
  let index = group ? 4 : 1;

  // After STREAMS, tokens are keys and IDs; a key named BLOCK must not change the mode.
  while (index < command.length) {
    const option = commandToken(command[index]);
    if (option === "STREAMS") return false;
    if (option === "BLOCK") return true;

    index += option === "COUNT" ? 2 : 1;
  }

  return false;
};

/** TS.READ has a fixed key/cursor prefix; a key named BLOCK is not an option. */
export const blockingTimeSeriesRead = (command: RedisCommand) => {
  for (let index = 3; index < command.length; index += 2) {
    if (commandToken(command[index]) === "BLOCK") return true;
  }
  return false;
};

/** The caller declares ordinary single-reply semantics; known session operations still fail closed. */
export const checkOrdinary = (command: RedisCommand) => {
  if (!Array.isArray(command) || command.length === 0) return undefined;

  const name = commandToken(command[0]);
  const subcommand = commandToken(command[1]);

  if (
    modes.has(name) ||
    (name === "TS.READ" && blockingTimeSeriesRead(command)) ||
    (name === "SCRIPT" && subcommand === "DEBUG") ||
    (name === "CLUSTER" && subcommand === "SYNCSLOTS") ||
    (name === "CLIENT" &&
      !["ID", "INFO", "LIST", "GETNAME", "GETREDIR", "HELP"].includes(subcommand)) ||
    ((name === "XREAD" || name === "XREADGROUP") && blockingRead(command, name === "XREADGROUP"))
  )
    return new AdmissionError({ reason: "session-required", delivery: "unsent" });

  return undefined;
};
