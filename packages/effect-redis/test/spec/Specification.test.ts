import { expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";

import { loadSpecification } from "../../tools/spec/Load.ts";
import {
  CompatibilityRecord,
  ProtocolProfile,
  ScenarioDefinition,
} from "../../tools/spec/Schema.ts";
import { validateSpecification } from "../../tools/spec/Validate.ts";

it.live("SPEC-01: tracked release inventory has intact hashes, owners and target coverage", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;
    expect(validateSpecification(spec)).toEqual([]);
  }),
);

it.live("SPEC-02: missing targets, commands and scenario ownership fail the gate", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;
    const broken = {
      ...spec,
      commands: spec.commands.slice(1),
      native: spec.native.filter((fixture) => fixture.product !== "keydb"),
      hosted: spec.hosted.filter((fixture) => fixture.provider !== "aiven"),
      runtimePairs: spec.runtimePairs.filter((pair) => pair.id !== "workerd-http"),
      scenarios: spec.scenarios.filter((scenario) => scenario.id !== "STREAM"),
    };
    const issues = validateSpecification(broken);
    expect(issues).toContain("Command inventory differs from the frozen release count");
    expect(issues).toContain("Missing engine: keydb");
    expect(issues).toContain("Missing provider: aiven");
    expect(issues).toContain("Missing runtime pair: workerd-http");
    expect(issues.some((issue) => issue.startsWith("Missing scenario for XADD"))).toBe(true);
  }),
);

it.live("SPEC-03: inventory rejects invented passes and containers counted as coverage", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;
    const commands = spec.commands.slice();
    const index = commands.findIndex((command) => command.name === "ACL");
    const container = commands[index];
    if (container === undefined) throw new Error("Missing ACL inventory entry");
    commands[index] = {
      ...container,
      mode: "ordinary",
      typedCoverage: "planned",
      execution: "passed",
    };
    const broken = { ...spec, commands };
    const issues = validateSpecification(broken);
    expect(issues).toContain("Container counted as an operation: ACL");
    expect(issues).toContain("Missing executed evidence: ACL");
    expect(issues).toContain("Unimplemented pass: ACL");
  }),
);

const record = {
  feature: "streams.consumer-groups",
  fixture: "valkey",
  availability: "unknown",
  semantics: "unverified",
  execution: "not-run",
  sourceIds: [],
} as const;

it.effect("SPEC-04: documented availability is separate from unexecuted semantics", () =>
  Effect.gen(function* () {
    const decode = Schema.decodeUnknownEffect(CompatibilityRecord);
    expect(yield* decode(record)).toEqual(record);
    const documented = { ...record, availability: "supported", sourceIds: ["valkey-core"] };
    expect(yield* decode(documented)).toEqual(documented);
    const passed = {
      ...documented,
      semantics: "matching",
      execution: "passed",
      evidence: {
        runId: "synthetic-schema-example",
        date: "2026-10-25",
        configuration: "schema validation only",
        scenarioIds: ["STREAM-EXAMPLE"],
        artifact: "not-a-conformance-result",
        engineVersion: "schema-only",
        runtimeVersion: "schema-only",
        moduleVersions: {},
        transport: "controlled",
        protocol: "none",
        topology: "none",
        authentication: "synthetic",
        configurationDigest: "0".repeat(64),
      },
    };
    expect(yield* decode(passed)).toEqual(passed);
  }),
);

it.effect(
  "SPEC-06: scenario definitions require isolation, deadlines and observable assertions",
  () =>
    Effect.gen(function* () {
      const scenario = {
        id: "CONFIG-01",
        family: "CONFIG",
        ownerPhase: 1,
        fixtures: ["controlled"],
        requiredCapabilities: [],
        isolation: "process",
        clock: "none",
        deadlineMillis: 5000,
        setup: "Construct synthetic configuration",
        operation: "Decode invalid credential-bearing URL",
        assertions: ["Typed failure contains no credential or URL"],
        cleanup: "No external resources acquired",
        expectedAvailability: "supported",
        expectedSemantics: "matching",
      };
      expect(yield* Schema.decodeUnknownEffect(ScenarioDefinition)(scenario)).toEqual(scenario);
      for (const invalid of [
        { ...scenario, assertions: [] },
        { ...scenario, deadlineMillis: 0 },
        { ...scenario, isolation: "shared-production" },
      ]) {
        expect(
          Result.isFailure(
            yield* Effect.result(Schema.decodeUnknownEffect(ScenarioDefinition)(invalid)),
          ),
        ).toBe(true);
      }
    }),
);

it.effect.each([
  { ...record, execution: "passed" },
  { ...record, semantics: "matching" },
  { ...record, availability: "supported" },
  { ...record, execution: "failed" },
])("SPEC-05: rejects unsupported evidence claims %#", (input) =>
  Effect.gen(function* () {
    expect(
      Result.isFailure(
        yield* Effect.result(Schema.decodeUnknownEffect(CompatibilityRecord)(input)),
      ),
    ).toBe(true);
  }),
);

it.live("SPEC-07: protocol evidence must reference declared scenario IDs", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;
    const protocol = yield* Schema.decodeUnknownEffect(ProtocolProfile)({
      ...spec.protocol,
      scenarios: spec.protocol.scenarios.filter((scenario) => scenario.id !== "WIRE-01"),
    });
    const broken = { ...spec, protocol };
    expect(validateSpecification(broken)).toContain("Missing protocol evidence scenario: WIRE-01");
  }),
);
