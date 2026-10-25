import { Crypto, Effect, Redacted, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { Argument, parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export interface RedisScript<A, E = never, R = never> {
  readonly source: Redacted.Redacted<Uint8Array>;
  readonly sha1: string;
  readonly readOnly: boolean;
  readonly decode: ReplyDecoder<A, E, R>;
}

/** SHA-1 is the Redis script identifier, not a password/security digest. */
export const make = Effect.fnUntraced(function* <A, E, R>(input: {
  readonly source: RedisArgument;
  readonly decode: ReplyDecoder<A, E, R>;
  readonly readOnly?: boolean;
}) {
  const body = yield* parse(Argument, input.source);
  const readOnly = yield* parse(Schema.Boolean, input.readOnly ?? false);
  const source = typeof body === "string" ? new TextEncoder().encode(body) : body.slice();
  const crypto = yield* Crypto.Crypto;
  const digest = yield* crypto.digest("SHA-1", source);

  return {
    source: Redacted.make(source),
    sha1: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    readOnly,
    decode: input.decode,
  } satisfies RedisScript<A, E, R>;
});
