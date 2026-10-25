import { Schema } from "effect";

import type { CommandMetadata } from "#/command/Metadata";

export { CommandMetadata as Descriptor } from "#/command/Metadata";

const Name = Schema.NonEmptyString;
const Names = Schema.NonEmptyArray(Name);
const Count = Schema.Int.check(Schema.isGreaterThan(0));
const Commit = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));
const Url = Schema.String.check(Schema.isPattern(/^https:\/\/[^\s]+$/));

/** A reusable test contract, not a record of when or whether it passed. */
export const ScenarioDefinition = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[A-Z]+-[0-9]+[A-Z0-9-]*$/)),
  family: Name,
  fixtures: Names,
  requiredCapabilities: Schema.Array(Name),
  isolation: Schema.Literals(["namespace", "database", "connection", "process", "cluster"]),
  clock: Schema.Literals(["virtual", "live", "none"]),
  deadlineMillis: Count,
  setup: Name,
  operation: Name,
  assertions: Names,
  cleanup: Name,
  expectedAvailability: Schema.Literals(["supported", "unsupported", "unknown"]),
  expectedSemantics: Schema.Literals(["matching", "different", "unverified"]),
});

export const ProtocolProfile = Schema.Struct({
  fixtureId: Name,
  specification: Name,
  sources: Schema.NonEmptyArray(Url),
  versions: Schema.NonEmptyArray(Schema.Literals(["RESP2", "RESP3"])),
  streamed: Schema.NonEmptyArray(Schema.Literals(["blob-string", "array", "map", "set"])),
  boundaries: Names,
  scenarios: Schema.NonEmptyArray(ScenarioDefinition),
});

export const TransportProfile = Schema.Struct({
  runtime: Schema.Literal("node"),
  baseline: Name,
  sources: Schema.NonEmptyArray(Url),
  boundaries: Names,
  scenarios: Schema.NonEmptyArray(ScenarioDefinition),
});

export const ConnectionProfile = Schema.Struct({
  fixtureId: Name,
  effectVersion: Name,
  sources: Schema.NonEmptyArray(Url),
  boundaries: Names,
  scenarios: Schema.NonEmptyArray(ScenarioDefinition),
});

export const CommandSystemProfile = Schema.Struct({
  fixtureId: Name,
  effectVersion: Name,
  sources: Schema.NonEmptyArray(Url),
  boundaries: Names,
  catalogs: Schema.NonEmptyArray(Schema.String.check(Schema.isPattern(/^[a-z-]+\.json$/))),
  descriptorCount: Count,
  scenarios: Schema.NonEmptyArray(ScenarioDefinition),
});

export const NativeFixture = Schema.Struct({
  id: Name,
  kind: Schema.Literals(["engine", "runtime"]),
  product: Name,
  version: Name,
  source: Schema.Struct({ repository: Url, commit: Schema.NullOr(Commit), refUrl: Url }),
  configuration: Name,
}).check(
  Schema.makeFilter((fixture) => fixture.kind === "runtime" || fixture.source.commit !== null),
);

export const NodeImage = Schema.Struct({
  version: Name,
  moduleList: Schema.optionalKey(Schema.Literal("unsupported")),
  architecture: Schema.optionalKey(Schema.Literals(["arm64", "x64"])),
  fixture: Name,
  image: Name,
  variant: Schema.optionalKey(Name),
  modules: Schema.optionalKey(Schema.Record(Name, Name)),
  digest: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
});

export interface Specification {
  readonly protocol: typeof ProtocolProfile.Type;
  readonly transport: typeof TransportProfile.Type;
  readonly connection: typeof ConnectionProfile.Type;
  readonly commandSystem: typeof CommandSystemProfile.Type;
  readonly descriptors: ReadonlyArray<CommandMetadata>;
  readonly native: ReadonlyArray<typeof NativeFixture.Type>;
  readonly nodeImages: ReadonlyArray<typeof NodeImage.Type>;
}
