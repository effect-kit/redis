import { array } from "#/command/reply/Collections";
import { pairs } from "#/command/reply/Data";
import { blob } from "#/command/reply/Scalars";
import { scoreToken } from "#/command/reply/Score";
import { scanCommand } from "#/commands/scan/Build";
import type { ScanOptions } from "#/commands/scan/Build";
import type { RedisArgument } from "#/RedisArgument";

export const zscan = (key: RedisArgument, cursor = "0", options: ScanOptions = {}) =>
  scanCommand("ZSCAN", cursor, options, pairs(blob, scoreToken), key);

/** NOSCORES is a Valkey option; other baselines can return a typed server error. */
export const zscanMembers = (key: RedisArgument, cursor = "0", options: ScanOptions = {}) =>
  scanCommand("ZSCAN", cursor, options, array(blob), key, "NOSCORES");
