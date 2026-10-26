import { Effect, Redacted, Schema } from "effect";

import { PayloadError } from "#/errors/PayloadError";

export interface PayloadCodec<A, RD = never, RE = never> {
  readonly encode: (value: A) => Effect.Effect<Uint8Array, PayloadError, RE>;
  readonly decode: (bytes: Uint8Array) => Effect.Effect<A, PayloadError, RD>;
}

const utf8 = new TextEncoder();

// A BOM is payload content here, not an instruction to strip the first character.
const decodeText = (bytes: Uint8Array) =>
  Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    catch: (cause) => new PayloadError({ stage: "decode", cause: Redacted.make(cause) }),
  });

/** The schema's encoded representation is UTF-8 text, with no implicit JSON conversion. */
export const schemaText = <A, RD, RE>(
  schema: Schema.Codec<A, string, RD, RE>,
): PayloadCodec<A, RD, RE> => {
  const encode = Schema.encodeEffect(schema);
  const decode = Schema.decodeUnknownEffect(schema);

  return {
    encode: (value) =>
      encode(value).pipe(
        Effect.map((text) => utf8.encode(text)),
        Effect.mapError(
          (cause) => new PayloadError({ stage: "encode", cause: Redacted.make(cause) }),
        ),
      ),

    decode: (bytes) =>
      decodeText(bytes).pipe(
        Effect.flatMap((text) =>
          decode(text).pipe(
            Effect.mapError(
              (cause) => new PayloadError({ stage: "decode", cause: Redacted.make(cause) }),
            ),
          ),
        ),
      ),
  };
};

export const text: PayloadCodec<string> = schemaText(Schema.String);

/** Canonical Schema JSON encoding is selected explicitly; services and refinements are retained. */
export const json = <S extends Schema.Constraint>(
  schema: S,
): PayloadCodec<S["Type"], S["DecodingServices"], S["EncodingServices"]> =>
  schemaText(Schema.fromJsonString(Schema.toCodecJson(schema)));
