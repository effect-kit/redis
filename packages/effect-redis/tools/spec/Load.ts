import { createHash } from "node:crypto";
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

const read = (file: string) =>
  Effect.tryPromise({
    try: () => readFile(new URL(file, root), "utf8"),
    catch: () => new SpecificationError({ file, reason: "Cannot read tracked specification" }),
  });

const parse = <S extends Schema.Constraint>(file: string, schema: S, content: string) =>
  Effect.try({
    try: (): unknown => JSON.parse(content),
    catch: () => new SpecificationError({ file, reason: "Invalid JSON" }),
  }).pipe(
    Effect.flatMap((input) =>
      Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(input),
    ),
    Effect.mapError(() => new SpecificationError({ file, reason: "Invalid specification schema" })),
  );

const load = <S extends Schema.Constraint>(file: string, schema: S) =>
  read(file).pipe(Effect.flatMap((content) => parse(file, schema, content)));

export const loadSpecification: Effect.Effect<Spec.Specification, SpecificationError> = Effect.gen(
  function* () {
    const commandSystem = yield* load("command-system.json", Spec.CommandSystemProfile);
    const descriptors = yield* Effect.forEach(commandSystem.catalogs, (file) =>
      load(`command-system/${file}`, Schema.NonEmptyArray(Spec.Descriptor)),
    );
    const index = yield* load("commands/index.json", Spec.CommandIndex);
    const groups = yield* Effect.forEach(
      index.categories,
      (category) =>
        Effect.gen(function* () {
          const file = `commands/${category.file}`;
          const content = yield* read(file);
          const commands = yield* parse(file, Schema.NonEmptyArray(Spec.Command), content);
          if (
            createHash("sha256")
              .update(JSON.stringify(JSON.parse(content)))
              .digest("hex") !== category.sha256
          ) {
            return yield* new SpecificationError({ file, reason: "Category checksum mismatch" });
          }
          return commands;
        }),
      { concurrency: 4 },
    );
    return {
      protocol: yield* load("protocol.json", Spec.ProtocolProfile),
      transport: yield* load("transport.json", Spec.TransportProfile),
      connection: yield* load("connection.json", Spec.ConnectionProfile),
      commandSystem,
      descriptors: descriptors.flat(),
      index,
      commands: groups.flat(),
      release: yield* load("release.json", Spec.Release),
      sources: yield* load("sources.json", Schema.NonEmptyArray(Spec.Source)),
      scenarios: yield* load("scenarios.json", Schema.NonEmptyArray(Spec.Scenario)),
      native: yield* load("fixtures/native.json", Schema.NonEmptyArray(Spec.NativeFixture)),
      nodeImages: yield* load("fixtures/node-images.json", Schema.NonEmptyArray(Spec.NodeImage)),
      hosted: yield* load("fixtures/hosted.json", Schema.NonEmptyArray(Spec.HostedFixture)),
      runtimePairs: yield* load(
        "fixtures/runtime-pairs.json",
        Schema.NonEmptyArray(Spec.RuntimePair),
      ),
      topologies: yield* load("fixtures/topologies.json", Schema.NonEmptyArray(Spec.Topology)),
    };
  },
);
