import { Schema } from "effect";

import { Receipt } from "#test/support/providers/Contract";
import { ProviderTestError } from "#test/support/providers/Failures";
import { providerCaseId } from "#test/support/providers/Matrix";
import type { ProviderCase } from "#test/support/providers/Matrix";

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Evidence = Schema.Struct({
  runId: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  artifactDigest: Digest,
  configurationDigest: Digest,
  observedAt: Schema.NonEmptyString,
  receipt: Receipt,
});

const mandatory = {
  data: ["data.binary-get", "data.int64", "data.strict-text"],
  collections: ["collections.hash-pairs", "collections.stream-read"],
  batches: ["batches.pipeline", "batches.transaction", "batches.no-rollback"],
  events: ["events.sse-utf8-comma", "events.joined-close"],
  extensions: [
    "extensions.vector-query",
    "extensions.search-query-codec",
    "extensions.search-drop",
  ],
  native: ["data.int64", "batches.transaction", "native.watch", "native.subscription-close"],
} as const;

export interface EvidenceRun {
  readonly runId: string;
  readonly artifactDigest: string;
  readonly startedAt: string;
  readonly runtimeVersions: Readonly<Record<string, string>>;
}

const fail = (): never => {
  throw new ProviderTestError({
    stage: "evidence",
    reason: "Missing, stale or inconsistent provider evidence",
  });
};

/** A partial selection certifies only itself; missing, stale, mixed or drifting receipts fail closed. */
export const certifyProviders = (
  expected: ReadonlyArray<ProviderCase>,
  records: ReadonlyMap<string, unknown>,
  run: EvidenceRun,
) => {
  if (expected.length === 0 || expected.length !== records.size) fail();
  const versions = new Map<string, string>();
  return expected.map((scenario) => {
    const id = providerCaseId(scenario);
    let record: typeof Evidence.Type;
    try {
      record = Schema.decodeUnknownSync(Evidence)(records.get(id));
    } catch {
      return fail();
    }
    const receipt = record.receipt;
    const at = Date.parse(record.observedAt);
    if (
      record.id !== id ||
      record.runId !== run.runId ||
      record.artifactDigest !== run.artifactDigest ||
      !Number.isFinite(at) ||
      at < Date.parse(run.startedAt) ||
      at > Date.now() + 1000
    )
      fail();
    if (
      receipt.provider !== scenario.provider ||
      receipt.runtime !== scenario.runtime ||
      receipt.protocol !== scenario.protocol ||
      receipt.scenario !== scenario.scenario ||
      receipt.runtimeVersion !== run.runtimeVersions[scenario.runtime]
    )
      fail();
    if (new Set(receipt.observations.map((entry) => entry.id)).size !== receipt.observations.length)
      fail();
    for (const observation of mandatory[scenario.scenario])
      if (
        !receipt.observations.some(
          (entry) => entry.id === observation && entry.outcome === "passed",
        )
      )
        fail();
    if (receipt.server.redisVersion === undefined && receipt.server.valkeyVersion === undefined)
      fail();

    const server = JSON.stringify(receipt.server);
    const family = ["workers", "upstash-http"].includes(scenario.provider)
      ? "upstash-native"
      : scenario.provider;
    const previous = versions.get(family);
    if (previous !== undefined && previous !== server) fail();
    versions.set(family, server);
    return record;
  });
};
