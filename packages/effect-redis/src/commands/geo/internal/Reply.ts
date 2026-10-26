import { Effect, Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { tuple, unsigned } from "#/command/reply/Data";
import { blob, mismatch, undecorate } from "#/command/reply/Scalars";
import { score } from "#/command/reply/Score";
import type { GeoDetails } from "#/commands/geo/internal/Query";

export interface GeoResult {
  readonly member: Uint8Array;
  readonly distance: Option.Option<number>;
  readonly hash: Option.Option<bigint>;
  readonly coordinates: Option.Option<readonly [number, number]>;
}

const hash: ReplyDecoder<bigint> = (reply) => {
  const value = undecorate(reply);
  // Dragonfly RESP3 marks an exact decimal hash as a double; parse its token without Number rounding.
  return unsigned(
    value._tag === "Double"
      ? { _tag: "BlobString", value: new TextEncoder().encode(value.value) }
      : reply,
  );
};

/** Redis fixes detail order independently of the order of WITH* argument flags. */
export const geoResults = (options: GeoDetails): ReplyDecoder<ReadonlyArray<GeoResult>> =>
  array<GeoResult, never, never>((reply) =>
    Effect.gen(function* () {
      const size =
        Number(options.distance ?? false) +
        Number(options.hash ?? false) +
        Number(options.coordinates ?? false);
      if (size === 0)
        return {
          member: yield* blob(reply),
          distance: Option.none(),
          hash: Option.none(),
          coordinates: Option.none(),
        };

      const value = undecorate(reply);
      if (value._tag !== "Array" || value.values.length !== size + 1)
        return yield* mismatch("array", reply);
      const member = value.values[0];
      if (member === undefined) return yield* mismatch("array", reply);
      let index = 1;

      const read = <A>(decode: ReplyDecoder<A>) => {
        const next = value.values[index++];
        return next === undefined
          ? Effect.fail(mismatch("array", reply))
          : decode(next).pipe(Effect.map(Option.some));
      };

      return {
        member: yield* blob(member),
        distance: options.distance ? yield* read(score) : Option.none(),
        // Dragonfly/Kvrocks return decimal bulk hashes; keep the integer exact in either encoding.
        hash: options.hash ? yield* read(hash) : Option.none(),
        coordinates: options.coordinates ? yield* read(tuple(score, score)) : Option.none(),
      };
    }),
  );
