import { Effect, Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { nullable, pairs } from "#/command/reply/Data";
import { mismatch, text } from "#/command/reply/Scalars";
import { ReplyError } from "#/errors/ReplyError";
import type { RespValue } from "#/protocol/RespValue";

/** Standard labels are text, but values and future extension fields stay lossless. */
export const record = Effect.fnUntraced(function* (reply: RespValue) {
  const attributes = yield* pairs(text, (value) => Effect.succeed(value))(reply);
  const read = <A>(name: string, decode: ReplyDecoder<A>) => {
    const index = attributes.findIndex(([key]) => key === name);
    const value = attributes[index]?.[1];
    return value === undefined
      ? Effect.fail(mismatch("custom", reply))
      : decode(value).pipe(
          Effect.mapError((error) => new ReplyError({ ...error, path: [index, ...error.path] })),
        );
  };
  const optional = <A>(name: string, decode: ReplyDecoder<A>) =>
    attributes.some(([key]) => key === name)
      ? read(name, nullable(decode))
      : Effect.succeed(Option.none<A>());
  return { attributes, read, optional };
});
