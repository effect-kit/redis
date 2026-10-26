import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { Schema } from "effect";

import { Receipt } from "#test/support/conformance/Contract";
import { caseId } from "#test/support/conformance/Matrix";
import type { EngineCase } from "#test/support/conformance/Matrix";
import { runtimeImage, bunRuntimeImage, bunRuntimeRevision } from "#test/support/servers/Targets";

const Evidence = Schema.Struct({
  runId: Schema.NonEmptyString,
  image: Schema.String,
  build: Schema.NonEmptyString,
  configurationDigest: Schema.String,
  observedAt: Schema.NonEmptyString,
  receipt: Receipt,
});

/** A passing aggregate cannot hide an absent case, stale runtime, different image or altered inventory. */
export const certifyRecords = (
  expected: ReadonlyArray<EngineCase>,
  records: ReadonlyMap<string, unknown>,
  runId: string,
) =>
  expected.map((scenario) => {
    const id = caseId(scenario);
    assert.ok(records.has(id), `Missing conformance evidence: ${id}`);
    const evidence = Schema.decodeUnknownSync(Evidence)(records.get(id));
    const { receipt } = evidence;
    assert.equal(evidence.runId, runId, `Stale conformance evidence: ${id}`);
    assert.equal(receipt.profile.id, scenario.target.product, id);
    assert.deepEqual(
      {
        engine: receipt.engine,
        version: receipt.version,
        protocol: receipt.protocol,
        runtime: receipt.runtime,
        domain: receipt.domain,
      },
      {
        engine: scenario.target.product,
        version: scenario.target.version,
        protocol: scenario.protocol,
        runtime: scenario.runtime,
        domain: scenario.domain,
      },
      id,
    );
    assert.equal(evidence.image, scenario.target.reference, id);
    assert.ok(evidence.build.includes(scenario.target.version), id);
    assert.match(evidence.configurationDigest, /^[a-f0-9]{64}$/, id);
    assert.ok(Number.isFinite(Date.parse(evidence.observedAt)), id);
    assert.equal(
      receipt.runtimeVersion,
      scenario.runtime === "node" ? runtimeImage.version : bunRuntimeImage.version,
      id,
    );
    if (scenario.runtime === "bun") assert.equal(receipt.runtimeRevision, bunRuntimeRevision, id);
    if (scenario.execution === "linux") assert.equal(receipt.platform, "linux", id);
    assert.equal(
      receipt.inventory.commandDigest,
      createHash("sha256").update(JSON.stringify(receipt.inventory.commands)).digest("hex"),
      id,
    );
    assert.equal(
      new Set(receipt.observations.map((row) => row.id)).size,
      receipt.observations.length,
      id,
    );

    return { id, execution: scenario.execution, ...evidence };
  });
