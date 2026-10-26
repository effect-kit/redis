import { Effect } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { pairs } from "#/command/reply/Data";
import { mismatch, undecorate } from "#/command/reply/Scalars";
import { losslessValue } from "#/commands/modules/Reply";
import type { RespValue } from "#/protocol/RespValue";

export type SearchFields = ReadonlyArray<readonly [Uint8Array, RespValue]>;
export const searchBytes: ReplyDecoder<Uint8Array> = (reply) => {
  const value = undecorate(reply);
  return value._tag === "BlobString" || value._tag === "SimpleString"
    ? Effect.succeed(value.value)
    : Effect.fail(mismatch("blob", reply));
};
/** Valkey aggregation returns simple-string field names; retain their bytes as with Redis bulk names. */
export const searchFields = pairs(searchBytes, losslessValue);
