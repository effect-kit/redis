import { Effect } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { mismatch, undecorate } from "#/command/reply/Scalars";
import { ReplyError } from "#/errors/ReplyError";

export const array =
  <A, E, R>(decode: ReplyDecoder<A, E, R>): ReplyDecoder<ReadonlyArray<A>, E, R> =>
  (reply) => {
    const value = undecorate(reply);
    if (value._tag !== "Array") return Effect.fail(mismatch("array", reply));
    return Effect.forEach(value.values, (entry, index) =>
      decode(entry).pipe(
        Effect.mapError((error) =>
          error instanceof ReplyError
            ? new ReplyError({ ...error, path: [index, ...error.path] })
            : error,
        ),
      ),
    );
  };
