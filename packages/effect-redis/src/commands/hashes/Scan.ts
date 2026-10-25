import { array } from "#/command/reply/Collections";
import { pairs } from "#/command/reply/Data";
import { blob } from "#/command/reply/Scalars";
import { scanCommand } from "#/commands/scan/Build";
import type { ScanOptions } from "#/commands/scan/Build";
import type { RedisArgument } from "#/RedisArgument";

export const hscan = (key: RedisArgument, cursor = "0", options: ScanOptions = {}) =>
  scanCommand("HSCAN", cursor, options, pairs(blob, blob), key);

export const hscanFields = (key: RedisArgument, cursor = "0", options: ScanOptions = {}) =>
  scanCommand("HSCAN", cursor, options, array(blob), key, "NOVALUES");
