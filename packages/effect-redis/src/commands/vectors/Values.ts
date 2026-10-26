import { Effect } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { blobs, nullable, pairs, simpleText, unsigned } from "#/command/reply/Data";
import { blob, mismatch, undecorate } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { integer, positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyed } from "#/commands/modules/Build";
import { moduleBoolean, moduleDouble } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

export interface RawEmbedding {
  readonly quantization: string;
  readonly bytes: Uint8Array;
  readonly norm: number;
  readonly quantizationRange?: number;
}
const rawEmbedding: ReplyDecoder<RawEmbedding> = (reply) => {
  const value = undecorate(reply);
  if (value._tag !== "Array" || (value.values.length !== 3 && value.values.length !== 4))
    return Effect.fail(mismatch("array", reply));
  const [quantization, bytes, norm, range] = value.values;
  if (quantization === undefined || bytes === undefined || norm === undefined)
    return Effect.fail(mismatch("array", reply));

  return Effect.gen(function* () {
    const result = {
      quantization: yield* simpleText(quantization),
      bytes: yield* blob(bytes),
      norm: yield* moduleDouble(norm),
    };
    return range === undefined
      ? result
      : { ...result, quantizationRange: yield* moduleDouble(range) };
  });
};

export const vrem = (key: RedisArgument, element: RedisArgument) =>
  moduleKeyed("vectorset", "VREM", key, moduleBoolean, Effect.succeed([element]), "read-write");
export const vismember = (key: RedisArgument, element: RedisArgument) =>
  moduleKeyed("vectorset", "VISMEMBER", key, moduleBoolean, Effect.succeed([element]));
export const vdim = (key: RedisArgument) => moduleKeyed("vectorset", "VDIM", key, unsigned);
export const vcard = (key: RedisArgument) => moduleKeyed("vectorset", "VCARD", key, unsigned);
export const vinfo = (key: RedisArgument) =>
  moduleKeyed("vectorset", "VINFO", key, nullable(fields));
export const vemb = (key: RedisArgument, element: RedisArgument) =>
  moduleKeyed("vectorset", "VEMB", key, nullable(array(moduleDouble)), Effect.succeed([element]));
export const vembRaw = (key: RedisArgument, element: RedisArgument) =>
  moduleKeyed("vectorset", "VEMB", key, nullable(rawEmbedding), Effect.succeed([element, "RAW"]));
export const vlinks = (key: RedisArgument, element: RedisArgument) =>
  moduleKeyed("vectorset", "VLINKS", key, nullable(array(blobs)), Effect.succeed([element]));
export const vlinksWithScores = (key: RedisArgument, element: RedisArgument) =>
  moduleKeyed(
    "vectorset",
    "VLINKS",
    key,
    nullable(array(pairs(blob, moduleDouble))),
    Effect.succeed([element, "WITHSCORES"]),
  );
export const vgetattr = (key: RedisArgument, element: RedisArgument) =>
  moduleKeyed("vectorset", "VGETATTR", key, nullable(blob), Effect.succeed([element]));
/** Empty JSON bytes remove attributes; other payloads are already encoded by the caller. */
export const vsetattr = (key: RedisArgument, element: RedisArgument, json: RedisArgument) =>
  moduleKeyed(
    "vectorset",
    "VSETATTR",
    key,
    moduleBoolean,
    Effect.succeed([element, json]),
    "read-write",
  );
export const vrandmember = (key: RedisArgument) =>
  moduleKeyed("vectorset", "VRANDMEMBER", key, nullable(blob));
export const vrandmemberCount = (key: RedisArgument, count: Integer) =>
  moduleKeyed("vectorset", "VRANDMEMBER", key, blobs, integer(count).pipe(Effect.map((n) => [n])));

export const vrange = (
  key: RedisArgument,
  start: RedisArgument,
  end: RedisArgument,
  count?: Integer,
) =>
  moduleKeyed(
    "vectorset",
    "VRANGE",
    key,
    blobs,
    count === undefined
      ? Effect.succeed([start, end])
      : positive(count).pipe(Effect.map((n) => [start, end, n])),
  );
