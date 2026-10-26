import { Effect } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { mismatch, undecorate } from "#/command/reply/Scalars";
import { ReplyError } from "#/errors/ReplyError";
import type { RespValue } from "#/protocol/RespValue";

export const elements = (reply: RespValue, minimum: number, maximum = minimum) => {
  const value = undecorate(reply);
  return value._tag === "Array" && value.values.length >= minimum && value.values.length <= maximum
    ? Effect.succeed(value.values)
    : Effect.fail(mismatch("array-length", reply));
};

export const at = <A>(values: ReadonlyArray<RespValue>, index: number, decode: ReplyDecoder<A>) => {
  const value = values[index];
  return value === undefined
    ? Effect.fail(
        new ReplyError({
          delivery: "replied",
          expected: "array-length",
          actual: "missing",
          path: [index],
        }),
      )
    : decode(value).pipe(
        Effect.mapError((error) => new ReplyError({ ...error, path: [index, ...error.path] })),
      );
};
