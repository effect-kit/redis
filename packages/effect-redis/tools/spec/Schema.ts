import { Schema } from "effect";

const Name = Schema.NonEmptyString;
const Names = Schema.NonEmptyArray(Name);
const Phase = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }));
const Count = Schema.Int.check(Schema.isGreaterThan(0));
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Commit = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));
const Url = Schema.String.check(Schema.isPattern(/^https:\/\/[^\s]+$/));
const Date = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
const Execution = Schema.Literals(["not-run", "passed", "failed", "blocked", "quarantined"]);

export const RunEvidence = Schema.Struct({
  runId: Name,
  date: Date,
  configuration: Name,
  scenarioIds: Names,
  artifact: Name,
  engineVersion: Name,
  runtimeVersion: Name,
  moduleVersions: Schema.Record(Name, Name),
  transport: Name,
  protocol: Name,
  topology: Name,
  authentication: Name,
  configurationDigest: Digest,
});

/** An executable scenario definition is added with its owning implementation phase. */
export const ScenarioDefinition = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[A-Z]+-[0-9]+[A-Z0-9-]*$/)),
  family: Name,
  ownerPhase: Phase,
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

/** Documentation availability and executed semantic evidence are independent. */
export const CompatibilityRecord = Schema.Struct({
  feature: Name,
  fixture: Name,
  availability: Schema.Literals(["supported", "unsupported", "unknown"]),
  semantics: Schema.Literals(["matching", "different", "unverified"]),
  execution: Execution,
  sourceIds: Schema.Array(Name),
  evidence: Schema.optionalKey(RunEvidence),
}).check(
  Schema.makeFilter(
    (record) =>
      (!(record.execution === "passed" || record.execution === "failed") ||
        record.evidence !== undefined) &&
      (record.semantics === "unverified" ||
        (record.execution === "passed" && record.evidence !== undefined)) &&
      (record.availability === "unknown" ||
        record.sourceIds.length > 0 ||
        record.evidence !== undefined),
  ),
);

export const Source = Schema.Struct({
  id: Name,
  url: Url,
  revision: Name,
  sha256: Digest,
  evidence: Schema.Literals(["metadata", "documentation"]),
});

export const Command = Schema.Struct({
  name: Name,
  category: Name,
  classification: Schema.Literals([
    "application",
    "module",
    "container",
    "internal",
    "deprecated",
    "alias",
    "extension",
    "unverified-extension",
  ]),
  typedCoverage: Schema.Literals(["planned", "container", "boundary", "review-required"]),
  mode: Schema.Literals([
    "ordinary",
    "blocking",
    "session",
    "subscription",
    "monitor",
    "node",
    "advanced",
    "metadata",
    "option-dependent",
  ]),
  ownerPhase: Phase,
  scenarioFamilies: Names,
  sources: Names,
  implementation: Schema.Literals(["planned", "implemented"]),
  execution: Execution,
  aliasOf: Schema.optionalKey(Name),
  notes: Schema.optionalKey(Name),
  evidence: Schema.optionalKey(RunEvidence),
});

export const CommandIndex = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  snapshotDate: Date,
  commandCount: Count,
  baselineCounts: Schema.Record(Name, Count),
  categories: Schema.NonEmptyArray(
    Schema.Struct({
      file: Schema.String.check(Schema.isPattern(/^[a-z-]+\.json$/)),
      sha256: Digest,
      count: Count,
    }),
  ),
});

export const Scenario = Schema.Struct({
  id: Name,
  ownerPhase: Phase,
  contract: Name,
  execution: Execution,
  clock: Schema.Literals(["virtual", "live", "none"]),
  evidence: Schema.optionalKey(RunEvidence),
});

export const NativeFixture = Schema.Struct({
  id: Name,
  kind: Schema.Literals(["engine", "module", "runtime"]),
  product: Name,
  version: Name,
  source: Schema.Struct({ repository: Url, commit: Schema.NullOr(Commit), refUrl: Url }),
  ownerPhase: Phase,
  configuration: Name,
  scenarioFamilies: Names,
  execution: Execution,
  evidence: Schema.optionalKey(RunEvidence),
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

export const HostedFixture = Schema.Struct({
  id: Name,
  provider: Name,
  product: Name,
  engine: Name,
  versionPolicy: Schema.Literal("capture-at-certification"),
  topology: Schema.Literals(["standalone", "provider-routed", "cluster", "http"]),
  transport: Schema.Literals(["resp-tls", "http", "sse"]),
  auth: Names,
  configuration: Name,
  source: Name,
  ownerPhase: Phase,
  scenarioFamilies: Names,
  execution: Execution,
  evidence: Schema.optionalKey(RunEvidence),
});

export const RuntimePair = Schema.Struct({
  id: Name,
  runtime: Name,
  fixture: Name,
  transport: Schema.Literals(["tcp", "tls", "unix", "http", "sse"]),
  ownerPhase: Phase,
  scenarioFamilies: Names,
  execution: Execution,
  evidence: Schema.optionalKey(RunEvidence),
});

export const Topology = Schema.Struct({
  id: Name,
  engine: Name,
  fixture: Name,
  topology: Schema.Literals(["cluster", "sentinel"]),
  size: Count,
  ownerPhase: Phase,
  scenarioFamilies: Names,
  execution: Execution,
  evidence: Schema.optionalKey(RunEvidence),
});

export const Release = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  baselineDate: Date,
  commandCount: Count,
  requiredEngines: Names,
  requiredProviders: Names,
  requiredModules: Names,
  requiredRuntimePairs: Names,
  requiredTopologies: Names,
  nativeVersionWindow: Names,
  hostedBuildGate: Name,
});

export interface Specification {
  readonly protocol: typeof ProtocolProfile.Type;
  readonly transport: typeof TransportProfile.Type;
  readonly release: typeof Release.Type;
  readonly index: typeof CommandIndex.Type;
  readonly commands: ReadonlyArray<typeof Command.Type>;
  readonly sources: ReadonlyArray<typeof Source.Type>;
  readonly scenarios: ReadonlyArray<typeof Scenario.Type>;
  readonly native: ReadonlyArray<typeof NativeFixture.Type>;
  readonly hosted: ReadonlyArray<typeof HostedFixture.Type>;
  readonly nodeImages: ReadonlyArray<typeof NodeImage.Type>;
  readonly runtimePairs: ReadonlyArray<typeof RuntimePair.Type>;
  readonly topologies: ReadonlyArray<typeof Topology.Type>;
}
