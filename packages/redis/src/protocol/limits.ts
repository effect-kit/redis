import { Result, Schema } from "effect";

import { Limits } from "#/config/Limits";
import { ProtocolError } from "#/errors/ProtocolError";

const DecodeLimits = Schema.Struct({
  maxHeaderBytes: Limits.fields.maxHeaderBytes,
  maxBlobBytes: Limits.fields.maxBlobBytes,
  maxBufferedBytes: Limits.fields.maxBufferedBytes,
  maxAggregateEntries: Limits.fields.maxAggregateEntries,
  maxNestingDepth: Limits.fields.maxNestingDepth,
}).check(
  Schema.makeFilter(
    (limits) =>
      limits.maxHeaderBytes <= limits.maxBufferedBytes &&
      limits.maxBlobBytes <= limits.maxBufferedBytes,
  ),
);

const EncodeLimits = Schema.Struct({
  maxQueuedBytes: Limits.fields.maxQueuedBytes,
  maxBlobBytes: Limits.fields.maxBlobBytes,
  maxAggregateEntries: Limits.fields.maxAggregateEntries,
});

export type RespDecodeLimits = typeof DecodeLimits.Type;
export type RespEncodeLimits = typeof EncodeLimits.Type;

const parseDecodeLimits = Schema.decodeUnknownResult(DecodeLimits);
const parseEncodeLimits = Schema.decodeUnknownResult(EncodeLimits);

export const decodeLimits = (options?: Partial<RespDecodeLimits>) =>
  parseDecodeLimits(options === undefined ? {} : options).pipe(
    Result.mapError(() => new ProtocolError({ stage: "config", kind: "InvalidLimits", offset: 0 })),
  );

export const encodeLimits = (options?: Partial<RespEncodeLimits>) =>
  parseEncodeLimits(options === undefined ? {} : options).pipe(
    Result.mapError(() => new ProtocolError({ stage: "config", kind: "InvalidLimits", offset: 0 })),
  );
