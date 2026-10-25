import { Context, Effect, Schema, SchemaTransformation } from "effect";

export class DecodeLabel extends Context.Service<DecodeLabel, { readonly prefix: string }>()(
  "test/DecodeLabel",
) {}

export class EncodeLabel extends Context.Service<EncodeLabel, { readonly prefix: string }>()(
  "test/EncodeLabel",
) {}

export const labelSchema = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transformEffect({
      decode: (value) => DecodeLabel.pipe(Effect.map(({ prefix }) => `${prefix}${value}`)),
      encode: (value) => EncodeLabel.pipe(Effect.map(({ prefix }) => `${prefix}${value}`)),
    }),
  ),
);
