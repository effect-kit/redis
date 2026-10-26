import { Effect, Schema } from "effect";

import { status } from "#/command/reply/Scalars";
import { nonNegative, NonNegative, parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyed } from "#/commands/modules/Build";
import { dumpChunk } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

export interface CuckooReserveOptions {
  readonly bucketSize?: Integer;
  readonly maxIterations?: Integer;
  readonly expansion?: Integer;
}
export const cfReserve = (
  key: RedisArgument,
  capacity: Integer,
  options: CuckooReserveOptions = {},
) =>
  moduleKeyed(
    "probabilistic",
    "CF.RESERVE",
    key,
    status("OK"),
    Effect.gen(function* () {
      const size = yield* parse(Positive, capacity);
      const selected = yield* parse(
        Schema.Struct({
          bucketSize: Schema.optionalKey(Positive),
          maxIterations: Schema.optionalKey(Positive),
          expansion: Schema.optionalKey(NonNegative),
        }),
        options,
      );
      return [
        String(size),
        ...(selected.bucketSize === undefined ? [] : ["BUCKETSIZE", String(selected.bucketSize)]),
        ...(selected.maxIterations === undefined
          ? []
          : ["MAXITERATIONS", String(selected.maxIterations)]),
        ...(selected.expansion === undefined ? [] : ["EXPANSION", String(selected.expansion)]),
      ];
    }),
    "write",
  );

export const cfScandump = (key: RedisArgument, cursor: Integer) =>
  moduleKeyed(
    "probabilistic",
    "CF.SCANDUMP",
    key,
    dumpChunk,
    nonNegative(cursor).pipe(Effect.map((value) => [value])),
  );
export const cfLoadchunk = (key: RedisArgument, cursor: Integer, chunk: Uint8Array) =>
  moduleKeyed(
    "probabilistic",
    "CF.LOADCHUNK",
    key,
    status("OK"),
    nonNegative(cursor).pipe(Effect.map((value) => [value, chunk])),
    "write",
  );

/** Despite the pinned server's readonly flag, compaction changes filter layout and stays primary-bound. */
export const cfCompact = (key: RedisArgument) =>
  moduleKeyed("probabilistic", "CF.COMPACT", key, status("OK"), Effect.succeed([]), "read-write");
