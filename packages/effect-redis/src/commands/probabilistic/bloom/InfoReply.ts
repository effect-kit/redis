import { Effect } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { simpleText } from "#/command/reply/Data";
import { mismatch, undecorate } from "#/command/reply/Scalars";

/** Redis wraps one selected field in an array/map; Valkey Bloom1.0 returns the scalar directly. */
export const bloomInfoField =
  <A>(label: string, decode: ReplyDecoder<A>): ReplyDecoder<A> =>
  (reply) =>
    Effect.gen(function* () {
      const value = undecorate(reply);
      if (value._tag === "Map") {
        const first = value.entries[0];
        if (
          value.entries.length !== 1 ||
          first === undefined ||
          (yield* simpleText(first[0])) !== label
        )
          return yield* mismatch("custom", reply);
        return yield* decode(first[1]);
      }
      if (value._tag === "Array") {
        const first = value.values[0];
        if (value.values.length !== 1 || first === undefined)
          return yield* mismatch("array", reply);
        return yield* decode(first);
      }
      return yield* decode(value);
    });
