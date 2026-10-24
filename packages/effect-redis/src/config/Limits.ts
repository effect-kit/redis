import { Effect, Schema } from "effect";

import { PositiveInteger } from "./Validation.js";

const budget = (value: number) =>
  PositiveInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));

export const Limits = Schema.Struct({
  maxHeaderBytes: budget(1024),
  maxBlobBytes: budget(64 * 1024 * 1024),
  maxBufferedBytes: budget(64 * 1024 * 1024 + 1024),
  maxAggregateEntries: budget(1_000_000),
  maxNestingDepth: budget(128),
  maxQueuedCommands: budget(1024),
  maxInFlightCommands: budget(128),
  maxQueuedBytes: budget(16 * 1024 * 1024),
  maxInFlightBytes: budget(16 * 1024 * 1024),
}).check(
  Schema.makeFilter((limits) =>
    limits.maxHeaderBytes <= limits.maxBufferedBytes &&
    limits.maxBlobBytes <= limits.maxBufferedBytes
      ? undefined
      : "Header/blob limits must fit within the buffered-byte limit",
  ),
);

export type Limits = typeof Limits.Type;
