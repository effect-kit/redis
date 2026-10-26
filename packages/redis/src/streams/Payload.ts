import { Effect, Option, Redacted } from "effect";

import type { PayloadCodec } from "#/codecs/PayloadCodec";
import type { GroupEntry, StreamEntry, StreamFields } from "#/commands/streams/Types";
import { PayloadError } from "#/errors/PayloadError";
import type { RedisArgument } from "#/RedisArgument";
import { argumentBytes, equalBytes } from "#/streams/internal/Argument";

const missingPayload = () =>
  new PayloadError({
    stage: "decode",
    cause: Redacted.make("Expected exactly one payload field with an available body"),
  });

export interface StreamPayload<A, RD = never, RE = never> {
  readonly encode: (
    value: A,
  ) => Effect.Effect<readonly [readonly [Uint8Array, Uint8Array]], PayloadError, RE>;
  readonly decode: (entry: StreamEntry) => Effect.Effect<A, PayloadError, RD>;
  readonly decodeGroup: (entry: GroupEntry) => Effect.Effect<A, PayloadError, RD>;
}

/** An explicit single-field envelope; unrelated raw fields are preserved by the caller's entry. */
export const field = <A, RD, RE>(
  name: RedisArgument,
  codec: PayloadCodec<A, RD, RE>,
): StreamPayload<A, RD, RE> => {
  const key = argumentBytes(name).slice();
  const decode = (fields: StreamFields) =>
    Effect.suspend(() => {
      const matches = fields.filter(([candidate]) => equalBytes(key, candidate));
      const bytes = matches[0]?.[1];
      return matches.length === 1 && bytes !== undefined
        ? codec.decode(bytes)
        : Effect.fail(missingPayload());
    });
  return {
    encode: (value) =>
      codec.encode(value).pipe(Effect.map((bytes) => [[key.slice(), bytes]] as const)),
    decode: (entry) => decode(entry.fields),
    decodeGroup: (entry) =>
      Option.isSome(entry.fields) ? decode(entry.fields.value) : Effect.fail(missingPayload()),
  };
};
