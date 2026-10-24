import type { Specification } from "./Schema.ts";

/** Gate planning completeness separately from future implementation/certification. */
export const validateSpecification = (spec: Specification): ReadonlyArray<string> => {
  const issues: Array<string> = [];
  const unique = (label: string, names: ReadonlyArray<string>) => {
    if (new Set(names).size !== names.length) issues.push(`Duplicate ${label}`);
    return new Set(names);
  };
  const sources = unique(
    "source IDs",
    spec.sources.map((source) => source.id),
  );
  const scenarios = unique(
    "scenario IDs",
    spec.scenarios.map((scenario) => scenario.id),
  );
  const commandNames = unique(
    "command names",
    spec.commands.map((command) => command.name),
  );
  const native = unique(
    "native fixture IDs",
    spec.native.map((fixture) => fixture.id),
  );
  const hosted = unique(
    "hosted fixture IDs",
    spec.hosted.map((fixture) => fixture.id),
  );
  unique("fixture IDs across native and hosted targets", [...native, ...hosted]);
  const runtimePairs = unique(
    "runtime pairs",
    spec.runtimePairs.map((pair) => pair.id),
  );
  const topologies = unique(
    "topology IDs",
    spec.topologies.map((topology) => topology.id),
  );
  const categories = unique(
    "categories",
    spec.index.categories.map((category) => category.file.slice(0, -5)),
  );
  const requireAll = (
    label: string,
    required: ReadonlyArray<string>,
    actual: ReadonlySet<string>,
  ) => {
    for (const name of required) if (!actual.has(name)) issues.push(`Missing ${label}: ${name}`);
  };
  const checkRun = (
    label: string,
    record: { readonly execution: string; readonly evidence?: unknown },
  ) => {
    if (
      (record.execution === "passed" || record.execution === "failed") &&
      record.evidence === undefined
    ) {
      issues.push(`Missing executed evidence: ${label}`);
    }
  };
  const protocolIds = unique(
    "protocol scenario IDs",
    spec.protocol.scenarios.map((scenario) => scenario.id),
  );
  requireAll("protocol version", ["RESP2", "RESP3"], new Set(spec.protocol.versions));
  requireAll(
    "streamed encoding",
    ["blob-string", "array", "map", "set"],
    new Set(spec.protocol.streamed),
  );
  for (const scenario of spec.protocol.scenarios) {
    requireAll("protocol scenario family", [scenario.family], scenarios);
    requireAll(
      "protocol controlled fixture",
      scenario.fixtures,
      new Set([spec.protocol.fixtureId]),
    );
    if (scenario.ownerPhase !== 2) issues.push(`Wrong protocol scenario owner: ${scenario.id}`);
  }
  for (const family of spec.scenarios.filter((scenario) =>
    ["WIRE", "SPLIT", "LIMIT"].includes(scenario.id),
  )) {
    if (family.evidence !== undefined)
      requireAll("protocol evidence scenario", family.evidence.scenarioIds, protocolIds);
  }
  if (
    spec.commands.length !== spec.release.commandCount ||
    spec.index.commandCount !== spec.release.commandCount
  ) {
    issues.push("Command inventory differs from the frozen release count");
  }
  for (const category of spec.index.categories) {
    if (
      spec.commands.filter((command) => command.category === category.file.slice(0, -5)).length !==
      category.count
    ) {
      issues.push(`Category count mismatch: ${category.file}`);
    }
  }
  for (const [source, count] of Object.entries(spec.index.baselineCounts)) {
    if (spec.commands.filter((command) => command.sources.includes(source)).length !== count) {
      issues.push(`Baseline count mismatch: ${source}`);
    }
  }
  for (const command of spec.commands) {
    requireAll(`source for ${command.name}`, command.sources, sources);
    requireAll(`scenario for ${command.name}`, command.scenarioFamilies, scenarios);
    requireAll("category", [command.category], categories);
    if (command.aliasOf !== undefined) requireAll("alias target", [command.aliasOf], commandNames);
    if (
      command.classification === "internal" &&
      (command.mode !== "advanced" || command.typedCoverage !== "boundary")
    ) {
      issues.push(`Internal operation lacks an explicit boundary: ${command.name}`);
    }
    if (
      command.classification === "container" &&
      (command.mode !== "metadata" || command.typedCoverage !== "container")
    ) {
      issues.push(`Container counted as an operation: ${command.name}`);
    }
    if (
      command.sources.some((source) => source === "redis-core" || source === "valkey-core") &&
      !["internal", "container"].includes(command.classification) &&
      command.typedCoverage !== "planned"
    ) {
      issues.push(`Public baseline command lacks typed coverage: ${command.name}`);
    }
    checkRun(command.name, command);
    if (command.execution === "passed" && command.implementation !== "implemented")
      issues.push(`Unimplemented pass: ${command.name}`);
  }
  requireAll(
    "engine",
    spec.release.requiredEngines,
    new Set(
      spec.native.filter((fixture) => fixture.kind === "engine").map((fixture) => fixture.product),
    ),
  );
  requireAll(
    "module",
    spec.release.requiredModules,
    new Set(
      spec.native.filter((fixture) => fixture.kind === "module").map((fixture) => fixture.id),
    ),
  );
  requireAll(
    "provider",
    spec.release.requiredProviders,
    new Set(spec.hosted.map((fixture) => fixture.provider)),
  );
  requireAll("version window", spec.release.nativeVersionWindow, native);
  requireAll("runtime pair", spec.release.requiredRuntimePairs, runtimePairs);
  requireAll("topology", spec.release.requiredTopologies, topologies);
  for (const fixture of [
    ...spec.native,
    ...spec.hosted,
    ...spec.runtimePairs,
    ...spec.topologies,
  ]) {
    requireAll(`scenario for ${fixture.id}`, fixture.scenarioFamilies, scenarios);
    checkRun(fixture.id, fixture);
  }
  for (const scenario of spec.scenarios) checkRun(scenario.id, scenario);
  for (const fixture of spec.hosted) requireAll("hosted documentation", [fixture.source], sources);
  for (const pair of spec.runtimePairs) {
    requireAll(
      "runtime",
      [pair.runtime],
      new Set(
        spec.native.filter((fixture) => fixture.kind === "runtime").map((fixture) => fixture.id),
      ),
    );
    requireAll("runtime target fixture", [pair.fixture], new Set([...native, ...hosted]));
  }
  for (const topology of spec.topologies)
    requireAll("topology fixture", [topology.fixture], native);
  return issues;
};
