import { readFileSync } from "node:fs";

import { Schema } from "effect";

const Name = Schema.NonEmptyString;
const ModuleFixture = Schema.Struct({
  id: Name,
  engine: Schema.Literals(["redis", "valkey"]),
  serverVersion: Name,
  image: Name,
  digest: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
  modules: Schema.Record(Name, Name),
  loadModules: Schema.NonEmptyArray(Schema.String.check(Schema.isPattern(/^\/[^\s]+\.so$/))),
  sources: Schema.NonEmptyArray(Schema.Struct({ repository: Name, ref: Name })),
});

/** This inventory describes the modules we actually load, independently of ordinary transport profiles. */
export const loadModuleManifest = () => {
  const fixtures = Schema.decodeUnknownSync(Schema.NonEmptyArray(ModuleFixture), {
    onExcessProperty: "error",
  })(
    JSON.parse(
      readFileSync(new URL("../../fixtures/modules/images.json", import.meta.url), "utf8"),
    ),
  );
  if (new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length)
    throw new Error("Duplicate module fixture IDs");

  return fixtures;
};

export const moduleFixtures = loadModuleManifest();
