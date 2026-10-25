import { array } from "#/command/reply/Collections";
import { blob } from "#/command/reply/Scalars";
import { scanCommand } from "#/commands/scan/Build";
import type { KeyScanOptions } from "#/commands/scan/Build";

export const scan = (cursor = "0", options: KeyScanOptions = {}) =>
  scanCommand("SCAN", cursor, options, array(blob));
