import { Effect, Option, Stream } from "effect";

import type { RedisExecutor } from "#/command/Executor";
import type { ArrayIndex } from "#/commands/arrays/internal/Index";
import * as Arrays from "#/commands/arrays/Scan";
import * as Hashes from "#/commands/hashes/Scan";
import * as Keys from "#/commands/keys/Scan";
import type { KeyScanOptions, ScanOptions } from "#/commands/scan/Build";
import * as Sets from "#/commands/sets/Scan";
import * as Sorted from "#/commands/sorted-sets/Scan";
import { scanEntries } from "#/iteration/Pages";
import type { RedisArgument } from "#/RedisArgument";

export const scanFamily = (executor: RedisExecutor) => ({
  scan: (...args: Parameters<typeof Keys.scan>) => executor.execute(Keys.scan(...args)),
  hscan: (...args: Parameters<typeof Hashes.hscan>) => executor.execute(Hashes.hscan(...args)),
  hscanFields: (...args: Parameters<typeof Hashes.hscanFields>) =>
    executor.execute(Hashes.hscanFields(...args)),
  sscan: (...args: Parameters<typeof Sets.sscan>) => executor.execute(Sets.sscan(...args)),
  zscan: (...args: Parameters<typeof Sorted.zscan>) => executor.execute(Sorted.zscan(...args)),
  zscanMembers: (...args: Parameters<typeof Sorted.zscanMembers>) =>
    executor.execute(Sorted.zscanMembers(...args)),
  arscan: (...args: Parameters<typeof Arrays.arscan>) => executor.execute(Arrays.arscan(...args)),

  scanKeys: (options: KeyScanOptions = {}) =>
    scanEntries((cursor) => executor.execute(Keys.scan(cursor, options))),
  scanHash: (key: RedisArgument, options: ScanOptions = {}) =>
    scanEntries((cursor) => executor.execute(Hashes.hscan(key, cursor, options))),
  scanHashFields: (key: RedisArgument, options: ScanOptions = {}) =>
    scanEntries((cursor) => executor.execute(Hashes.hscanFields(key, cursor, options))),
  scanSet: (key: RedisArgument, options: ScanOptions = {}) =>
    scanEntries((cursor) => executor.execute(Sets.sscan(key, cursor, options))),
  scanSortedSet: (key: RedisArgument, options: ScanOptions = {}) =>
    scanEntries((cursor) => executor.execute(Sorted.zscan(key, cursor, options))),
  scanSortedMembers: (key: RedisArgument, options: ScanOptions = {}) =>
    scanEntries((cursor) => executor.execute(Sorted.zscanMembers(key, cursor, options))),
  scanArray: (
    key: RedisArgument,
    start: ArrayIndex,
    end: ArrayIndex,
    options: Arrays.ArrayScanOptions = {},
  ) =>
    Stream.paginate(start, (position) =>
      executor
        .execute(Arrays.arscan(key, position, end, { ...options, limit: options.limit ?? 128 }))
        .pipe(
          Effect.map((entries) => {
            const last = entries.at(-1)?.[0];
            const reverse = BigInt(start) > BigInt(end);
            return [
              entries,
              last === undefined || (reverse ? last <= BigInt(end) : last >= BigInt(end))
                ? Option.none<ArrayIndex>()
                : Option.some<ArrayIndex>(last + (reverse ? -1n : 1n)),
            ] as const;
          }),
        ),
    ),
});
