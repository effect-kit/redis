import { createHash } from "node:crypto";

import { expect, it } from "@effect/vitest";

import { certifyRecords } from "#test/support/conformance/Evidence";
import { caseId } from "#test/support/conformance/Matrix";
import type { EngineCase } from "#test/support/conformance/Matrix";
import { serverTargets, runtimeImage } from "#test/support/servers/Targets";

const target = serverTargets.find((candidate) => candidate.fixture === "redis");
if (target === undefined) throw new Error("Missing reviewed Redis fixture");
const scenario: EngineCase = {
  target,
  runtime: "node",
  protocol: "resp2",
  domain: "strings",
  execution: "linux",
};
const id = caseId(scenario);
const commands = ["GET", "SET"];
const evidence = {
  runId: "unit",
  image: target.reference,
  build: `Redis ${target.version}`,
  configurationDigest: "0".repeat(64),
  observedAt: "2026-10-27T00:00:00.000Z",
  receipt: {
    profile: { id: "redis", revision: "reviewed-2026-10-26" },
    runtime: "node",
    runtimeVersion: runtimeImage.version,
    platform: "linux",
    architecture: "arm64",
    engine: "redis",
    version: target.version,
    protocol: "resp2",
    domain: "strings",
    inventory: {
      commands,
      commandDigest: createHash("sha256").update(JSON.stringify(commands)).digest("hex"),
      moduleInventory: "listed",
      modules: [],
    },
    observations: [{ id: "strings.get", command: "GET", outcome: "passed" }],
  },
};

it("ENGINE-EVIDENCE: missing required cases cannot become a passing certificate", () => {
  expect(() => certifyRecords([scenario], new Map(), "unit")).toThrow(
    "Missing conformance evidence",
  );
  expect(certifyRecords([scenario], new Map([[id, evidence]]), "unit")).toHaveLength(1);
});

it.each([
  [
    "stale run",
    (record: typeof evidence) => {
      record.runId = "previous";
    },
  ],
  [
    "different image",
    (record: typeof evidence) => {
      record.image = "different-image";
    },
  ],
  [
    "different protocol",
    (record: typeof evidence) => {
      record.receipt.protocol = "resp3";
    },
  ],
  [
    "stale runtime",
    (record: typeof evidence) => {
      record.receipt.runtimeVersion = "0.0.0";
    },
  ],
  [
    "different platform",
    (record: typeof evidence) => {
      record.receipt.platform = "darwin";
    },
  ],
  [
    "altered command set",
    (record: typeof evidence) => {
      record.receipt.inventory.commands.push("INCR");
    },
  ],
  [
    "duplicate scenario",
    (record: typeof evidence) => {
      record.receipt.observations.push(
        record.receipt.observations[0] ?? { id: "strings.get", command: "GET", outcome: "passed" },
      );
    },
  ],
] as const)("ENGINE-EVIDENCE: %s is rejected", (_label, mutate) => {
  const record = structuredClone(evidence);
  mutate(record);
  expect(() => certifyRecords([scenario], new Map([[id, record]]), "unit")).toThrow();
});
