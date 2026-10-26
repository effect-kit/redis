import { array } from "#/command/reply/Collections";
import { blob } from "#/command/reply/Scalars";
import { scanCommand } from "#/commands/scan/Build";
import type { ScanOptions } from "#/commands/scan/Build";
import type { RedisArgument } from "#/RedisArgument";

export const sscan = (key: RedisArgument, cursor = "0", options: ScanOptions = {}) =>
  scanCommand("SSCAN", cursor, options, array(blob), key);
