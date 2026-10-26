import type { PreparedCommand } from "#/command/Command";
import { commandToken } from "#/connection/OrdinaryCommand";

const statuses = new Set([
  "MSET",
  "SETEX",
  "PSETEX",
  "LSET",
  "LTRIM",
  "RENAME",
  "RESTORE",
  "HMSET",
  "XGROUP CREATE",
  "XGROUP SETID",
  "XCFGSET",
  "JSON.SET",
  "JSON.MSET",
  "JSON.MERGE",
  "SCRIPT FLUSH",
  "SCRIPT KILL",
  "FUNCTION DELETE",
  "FUNCTION FLUSH",
  "FUNCTION RESTORE",
  "FUNCTION KILL",
  "TS.CREATE",
  "TS.ALTER",
  "TS.CREATERULE",
  "TS.DELETERULE",
  "BF.RESERVE",
  "CF.RESERVE",
  "CF.LOADCHUNK",
  "CF.COMPACT",
  "CMS.INITBYDIM",
  "CMS.INITBYPROB",
  "CMS.MERGE",
  "TOPK.RESERVE",
  "TDIGEST.CREATE",
  "TDIGEST.RESET",
  "TDIGEST.MERGE",
  "FT.CREATE",
  "FT.ALTER",
  "FT.DROPINDEX",
  "FT.ALIASADD",
  "FT.ALIASUPDATE",
  "FT.ALIASDEL",
  "FT.CURSOR DEL",
]);

/** JSON erases RESP status/blob distinctions. Reconstruct only reviewed command semantics. */
export const jsonStatus = (command: PreparedCommand<unknown, unknown, unknown>) => {
  if (command.metadata.name === "PING" && command.tokens.length === 1) return true;
  if (command.metadata.name !== "SET") return statuses.has(command.metadata.name);

  for (let index = 3; index < command.tokens.length;) {
    const flag = commandToken(command.tokens[index]);
    if (flag === "GET") return false;
    index += ["NX", "XX", "KEEPTTL"].includes(flag) ? 1 : 2;
  }
  return true;
};

export const ambiguousJson = (command: PreparedCommand<unknown, unknown, unknown>) =>
  command.metadata.family === "custom" ||
  ["EVAL", "EVAL_RO", "EVALSHA", "EVALSHA_RO", "FCALL", "FCALL_RO"].includes(command.metadata.name);

export interface JsonReplyPolicy {
  readonly status: boolean;
  readonly ambiguous: boolean;
}

export const jsonReplyPolicy = (
  command: PreparedCommand<unknown, unknown, unknown>,
): JsonReplyPolicy => ({
  status: jsonStatus(command),
  ambiguous: ambiguousJson(command),
});
