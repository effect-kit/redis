import { Effect } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { mismatch, undecorate } from "#/command/reply/Scalars";

/** Preserves the server's decimal token; numeric conversion is an explicit separate decoder. */
export const scoreToken: ReplyDecoder<string> = (reply) => {
  const value = undecorate(reply);
  const token =
    value._tag === "Double"
      ? value.value
      : value._tag === "BlobString"
        ? new TextDecoder().decode(value.value)
        : undefined;
  if (
    token === undefined ||
    !/^(?:[+-]?inf|[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)$/.test(token)
  )
    return Effect.fail(mismatch("score", reply));
  const number =
    token === "inf" || token === "+inf" ? Infinity : token === "-inf" ? -Infinity : Number(token);
  if (!Number.isFinite(number) && !/^[+-]?inf$/.test(token))
    return Effect.fail(mismatch("score", reply));
  return Effect.succeed(token);
};
export const score: ReplyDecoder<number> = (reply) =>
  scoreToken(reply).pipe(
    Effect.map((token) =>
      token === "inf" || token === "+inf" ? Infinity : token === "-inf" ? -Infinity : Number(token),
    ),
  );
