import { readFileSync } from "node:fs";

import { Schema } from "effect";

import type { Receipt } from "#test/support/hardening/Contract";

const Positive = Schema.Number.check(Schema.isGreaterThan(0));
const Budget = Schema.Struct({
  version: Schema.Literal(1),
  windows: Schema.Int.check(Schema.isGreaterThan(0)),
  windowMillis: Positive,
  soakMillis: Positive,
  minimumCycles: Positive,
  minimumSamples: Positive,
  maximumHeapGrowthBytes: Positive,
  maximumHeapSlopeBytesPerSecond: Positive,
  maximumRssBytes: Positive,
  maximumRetainedHeapBytes: Positive,
  minimumTelemetryThroughputRatio: Positive,
  workloads: Schema.Record(
    Schema.String,
    Schema.Struct({ minimumOperationsPerSecond: Positive, maximumP99Millis: Positive }),
  ),
});

export const budgets = Schema.decodeUnknownSync(Budget)(
  JSON.parse(
    readFileSync(new URL("../../fixtures/hardening/budgets.json", import.meta.url), "utf8"),
  ),
);

const requireBudget = (condition: boolean, reason: string) => {
  if (!condition) throw new Error(`Hardening budget failed: ${reason}`);
};

const median = (values: ReadonlyArray<number>) => {
  const result = values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)];
  if (result === undefined || !Number.isFinite(result))
    throw new Error("Missing finite measurement");
  return result;
};

/** Evaluate measured behavior, not declared capabilities. Incomplete windows cannot certify. */
export const certifyBenchmark = (receipt: Receipt) => {
  const expected = Object.keys(budgets.workloads).filter((key) =>
    key.startsWith(`${receipt.transport}:`),
  );
  requireBudget(expected.length === 10, "unknown transport/workload selection");
  requireBudget(
    receipt.benchmark.length === expected.length * budgets.windows,
    "missing or extra measurement windows",
  );
  requireBudget(
    receipt.postCleanup.heapUsedBytes <= budgets.maximumRetainedHeapBytes,
    "post-cleanup retained heap",
  );
  for (const key of expected) {
    const name = key.slice(receipt.transport.length + 1);
    const rows = receipt.benchmark.filter((row) => row.workload === name);
    const threshold = budgets.workloads[key];
    if (threshold === undefined) throw new Error("Missing reviewed workload budget");
    requireBudget(rows.length === budgets.windows, `${name}: incomplete windows`);
    for (const row of rows) {
      requireBudget(
        row.elapsedMillis >= budgets.windowMillis && row.latency.count >= 10,
        `${name}: too few samples`,
      );
      requireBudget(row.rssBytes <= budgets.maximumRssBytes, `${name}: RSS`);
      requireBudget(
        receipt.runtime === "bun" ? row.gcMillis === null : row.gcMillis !== null,
        `${name}: GC availability`,
      );
      if (receipt.transport !== "http" && name !== "pipeline-32-c4")
        requireBudget(row.queueWaitMeanMillis !== null, `${name}: missing native queue wait`);
    }
    requireBudget(
      median(rows.map((row) => row.operationsPerSecond)) >= threshold.minimumOperationsPerSecond,
      `${name}: throughput`,
    );
    requireBudget(
      median(rows.map((row) => row.latency.p99Millis)) <= threshold.maximumP99Millis,
      `${name}: p99 latency`,
    );
  }
  const throughput = (name: string) =>
    median(
      receipt.benchmark
        .filter((row) => row.workload === name)
        .map((row) => row.operationsPerSecond),
    );
  for (const name of ["get-metrics-c32", "get-tracing-c32"])
    requireBudget(
      throughput(name) / throughput("get-256b-c32") >= budgets.minimumTelemetryThroughputRatio,
      `${name}: telemetry overhead`,
    );
};

export const certifySoak = (receipt: Receipt) => {
  const soak = receipt.soak;
  if (soak === undefined) throw new Error("Missing soak measurements");
  requireBudget(
    receipt.postCleanup.heapUsedBytes <= budgets.maximumRetainedHeapBytes,
    "post-cleanup retained heap",
  );
  requireBudget(soak.elapsedMillis >= budgets.soakMillis, "soak duration");
  requireBudget(soak.cycles >= budgets.minimumCycles, "soak cycles");
  requireBudget(soak.samples.length >= budgets.minimumSamples, "retained-heap sample count");
  requireBudget(soak.heapGrowthBytes <= budgets.maximumHeapGrowthBytes, "retained-heap growth");
  requireBudget(
    soak.retainedHeapSlopeBytesPerSecond <= budgets.maximumHeapSlopeBytesPerSecond,
    "retained-heap slope",
  );
  requireBudget(
    receipt.transport === "http" && receipt.runtime === "bun"
      ? soak.resourceGrowth === null
      : soak.resourceGrowth !== null && soak.resourceGrowth <= 0,
    "retained handles",
  );
  requireBudget(
    soak.samples.every(
      (sample) =>
        (receipt.transport === "http"
          ? sample.sockets === null || sample.sockets <= 64
          : sample.sockets === 0) && sample.rssBytes <= budgets.maximumRssBytes,
    ),
    "server clients/RSS",
  );
  const required =
    receipt.transport === "http"
      ? [
          "binary-ownership",
          "bounded-concurrency",
          "pipeline",
          "transaction",
          "explicit-rotation-future-session",
          "post-gc-memory",
          "sustained-http-layer",
        ]
      : [
          "binary-ownership",
          "pipeline",
          "transaction",
          "pubsub-server-cleanup",
          "scoped-group-reader",
          "explicit-rotation-future-session",
          "zero-waiters-leases-listeners",
          "post-gc-memory",
          "joined-scope-cleanup",
          "server-client-cleanup",
        ];
  for (const check of required)
    requireBudget(soak.checks.includes(check), `missing soak assertion: ${check}`);
};
