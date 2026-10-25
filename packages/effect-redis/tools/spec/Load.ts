import { readFile } from "node:fs/promises";

import { Effect, Schema } from "effect";

import * as Spec from "./Schema.ts";

export class SpecificationError extends Schema.TaggedError<SpecificationError>()(
  "SpecificationError",
  {
    file: Schema.String,
    reason: Schema.String,
  },
) {}

const root = new URL("../../../../spec/", import.meta.url);

const load = <S extends Schema.Constraint>(file: string, schema: S) =>
  Effect.tryPromise({
    try: () => readFile(new URL(file, root), "utf8"),
    catch: () => new SpecificationError({ file, reason: "Cannot read tracked specification" }),
  }).pipe(
    Effect.flatMap((content) =>
      Effect.try({
        try: (): unknown => JSON.parse(content),
        catch: () => new SpecificationError({ file, reason: "Invalid JSON" }),
      }),
    ),
    Effect.flatMap((input) =>
      Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(input),
    ),
    Effect.mapError(() => new SpecificationError({ file, reason: "Invalid specification" })),
  );

export const loadSpecification: Effect.Effect<Spec.Specification, SpecificationError> = Effect.gen(
  function* () {
    const commandSystem = yield* load("command-system.json", Spec.CommandSystemProfile);
    const descriptors = yield* Effect.forEach(commandSystem.catalogs, (file) =>
      load(`command-system/${file}`, Schema.NonEmptyArray(Spec.Descriptor)),
    );

    return {
      protocol: yield* load("protocol.json", Spec.ProtocolProfile),
      transport: yield* load("transport.json", Spec.TransportProfile),
      connection: yield* load("connection.json", Spec.ConnectionProfile),
      commandSystem,
      descriptors: descriptors.flat(),
      native: yield* load("fixtures/native.json", Schema.NonEmptyArray(Spec.NativeFixture)),
      nodeImages: yield* load("fixtures/node-images.json", Schema.NonEmptyArray(Spec.NodeImage)),
    };
  },
);
