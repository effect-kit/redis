import { Effect, Schema } from "effect";

import { parse } from "#/commands/internal/Input";

const Coordinates = Schema.NonEmptyArray(
  Schema.Number.check(
    Schema.isFinite(),
    Schema.makeFilter((n) => Number.isFinite(Math.fround(n))),
  ),
);

/** Explicit byte order avoids inheriting the application's CPU layout. Redis FP32 uses server-native floats. */
export const encodeFloat32 = (
  coordinates: readonly [number, ...number[]],
  byteOrder: "little" | "big" = "little",
) =>
  Effect.gen(function* () {
    const selected = yield* parse(Coordinates, coordinates);
    const order = yield* parse(Schema.Literals(["little", "big"]), byteOrder);
    const bytes = new Uint8Array(selected.length * 4);
    const view = new DataView(bytes.buffer);

    selected.forEach((value, index) => view.setFloat32(index * 4, value, order === "little"));
    return bytes;
  });
