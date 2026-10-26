import { Effect, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";

import { encodeFloat32 } from "#/codecs/vector/Float32";
import { Finite, parse } from "#/commands/internal/Input";
import { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

const Coordinates = Schema.NonEmptyArray(
  Finite.check(Schema.makeFilter((value) => Number.isFinite(Math.fround(value)))),
).check(Schema.isMaxLength(32768));
const Bytes = Schema.Uint8Array.check(
  Schema.makeFilter(
    (bytes) => bytes.length > 0 && bytes.length <= 32768 * 4 && bytes.length % 4 === 0,
  ),
);
const Input = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Values"), coordinates: Coordinates }),
  Schema.Struct({ _tag: Schema.Literal("FP32"), bytes: Bytes }),
  Schema.Struct({
    _tag: Schema.Literal("Base64FP32"),
    base64: Schema.String.check(Schema.isMaxLength(174764)),
  }),
]);
export type UpstashVectorInput = typeof Input.Type;

const validateCoordinates = (bytes: Uint8Array) =>
  Effect.gen(function* () {
    const selected = yield* parse(Bytes, bytes);
    const view = new DataView(selected.buffer, selected.byteOffset, selected.byteLength);
    for (let offset = 0; offset < selected.length; offset += 4)
      if (!Number.isFinite(view.getFloat32(offset, true)))
        return yield* new CommandInputError({ delivery: "unsent", reason: "arguments" });
    return selected;
  });

export const vectorArguments = Effect.fnUntraced(function* (
  input: UpstashVectorInput,
): Effect.fn.Return<ReadonlyArray<RedisArgument>, CommandInputError> {
  const selected = yield* parse(Input, input);
  if (selected._tag === "Values")
    return ["VALUES", String(selected.coordinates.length), ...selected.coordinates.map(String)];
  if (selected._tag === "FP32") return ["FP32", yield* validateCoordinates(selected.bytes)];

  const decoded = Base64.decode(selected.base64);
  if (Result.isFailure(decoded) || Base64.encode(decoded.success) !== selected.base64)
    return yield* new CommandInputError({ delivery: "unsent", reason: "arguments" });
  yield* validateCoordinates(decoded.success);
  return ["BASE64-FP32", selected.base64];
});

/** Explicit little-endian FP32 encoding suitable for JSON HTTP arguments. */
export const base64Fp32 = Effect.fnUntraced(function* (
  coordinates: readonly [number, ...number[]],
) {
  const values = yield* parse(Coordinates, coordinates);
  const bytes = yield* encodeFloat32(values);

  return { _tag: "Base64FP32", base64: Base64.encode(bytes) } as const;
});
