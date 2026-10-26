import { Effect, Redacted } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import type { Routing } from "#/command/Metadata";
import { array } from "#/command/reply/Collections";
import { pairs, simpleText } from "#/command/reply/Data";
import { text, undecorate } from "#/command/reply/Scalars";
import { ordinary } from "#/commands/internal/Command";
import { metadata } from "#/commands/Metadata";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisArgument } from "#/RedisArgument";

export const lossless: ReplyDecoder<RespValue> = Effect.succeed;
export const fields = pairs(simpleText, lossless);
export const help = array(simpleText);
export const reportText: ReplyDecoder<string> = (reply) => {
  const value = undecorate(reply);

  // Redis reports use RESP3 verbatim framing; the textual result intentionally omits its format tag.
  return value._tag === "VerbatimString"
    ? text({ _tag: "BlobString", value: value.value })
    : simpleText(reply);
};
export const sensitive =
  <A>(decode: ReplyDecoder<A>): ReplyDecoder<Redacted.Redacted<A>> =>
  (reply) =>
    decode(reply).pipe(Effect.map(Redacted.make));

/** Administrative intent is bound to one explicitly configured native lease, never broadcast. */
export const nodeCommand = <A>(
  name: string,
  decode: ReplyDecoder<A>,
  tail: Effect.Effect<ReadonlyArray<RedisArgument>, CommandInputError> = Effect.succeed([]),
  routing: Routing = { _tag: "Keyless" },
  availability: ReadonlyArray<string> = [],
) =>
  ordinary(
    { ...metadata(name, "administration", ["ADMIN"], availability), execution: "exclusive" },
    decode,
    tail.pipe(
      Effect.map((args) => {
        const [first = "", ...rest] = name.split(" ");

        return { tokens: [first, ...rest, ...args] as const, routing };
      }),
    ),
  );
