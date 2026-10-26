import { blockingRead, blockingTimeSeriesRead, commandToken } from "#/connection/OrdinaryCommand";
import { SessionError } from "#/errors/SessionError";
import type { RedisCommand } from "#/protocol/encode";

const blockers = new Set([
  "BLPOP",
  "BRPOP",
  "BRPOPLPUSH",
  "BLMOVE",
  "BLMPOP",
  "BLMOVEM",
  "BZPOPMIN",
  "BZPOPMAX",
  "BZMPOP",
]);
const modes = new Set([
  "DEBUG",
  "ASKING",
  "READONLY",
  "READWRITE",
  "MULTI",
  "EXEC",
  "WATCH",
  "UNWATCH",
  "DISCARD",
  "AUTH",
  "HELLO",
  "SELECT",
  "RESET",
  "QUIT",
  "MONITOR",
  "SUBSCRIBE",
  "PSUBSCRIBE",
  "SSUBSCRIBE",
  "UNSUBSCRIBE",
  "PUNSUBSCRIBE",
  "SUNSUBSCRIBE",
  "SHUTDOWN",
  "SYNC",
  "PSYNC",
  "REPLCONF",
]);

export const isBlocking = (command: RedisCommand) => {
  const name = commandToken(command[0]);
  return (
    blockers.has(name) ||
    (name === "TS.READ" && blockingTimeSeriesRead(command)) ||
    ((name === "XREAD" || name === "XREADGROUP") && blockingRead(command, name === "XREADGROUP"))
  );
};

/** Explicit advanced raw calls declare one reply and taint their lease; mode switches stay reviewed. */
export const checkAdvanced = (command: RedisCommand) => {
  const name = commandToken(command[0]);
  if (
    (name === "SCRIPT" && commandToken(command[1]) === "DEBUG") ||
    (name === "CLUSTER" && commandToken(command[1]) === "SYNCSLOTS") ||
    modes.has(name) ||
    (name === "CLIENT" && ["REPLY", "IMPORT-SOURCE", "CACHING"].includes(commandToken(command[1])))
  )
    return new SessionError({ reason: "execution-mode", delivery: "unsent" });
  return undefined;
};
