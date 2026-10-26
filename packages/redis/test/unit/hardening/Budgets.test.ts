/* oxlint-disable no-map-spread -- Rejection cases preserve the passing reference measurement. */
import { expect, it } from "vitest";

import { budgets, certifyBenchmark, certifySoak } from "#test/support/hardening/Budgets";
import type { Receipt } from "#test/support/hardening/Contract";

const receipt = (): Receipt => ({
  runtime: "node",
  runtimeVersion: "24.22.0",
  platform: "darwin",
  architecture: "arm64",
  engine: "redis",
  transport: "tcp",
  protocol: "resp3",
  rttMillis: 1,
  benchmark: Object.entries(budgets.workloads)
    .filter(([key]) => key.startsWith("tcp:"))
    .flatMap(([key, budget]) =>
      Array.from({ length: budgets.windows }, () => ({
        workload: key.slice(4),
        concurrency: 1,
        commandsPerOperation: 1,
        payloadBytes: 256,
        elapsedMillis: budgets.windowMillis,
        operationsPerSecond: budget.minimumOperationsPerSecond * 2,
        commandsPerSecond: budget.minimumOperationsPerSecond * 2,
        latency: { count: 100, p50Millis: 1, p95Millis: 1, p99Millis: 1, maximumMillis: 1 },
        cpuMillis: 100,
        cpuUtilization: 0.2,
        heapUsedBytes: 1024,
        rssBytes: 1024,
        gcMillis: 0,
        queueWaitMeanMillis: 0,
      })),
    ),
  postCleanup: { heapUsedBytes: 1024, rssBytes: 1024, externalBytes: 0, arrayBufferBytes: 0 },
});

it("rejects missing measurements and large throughput/latency regressions", () => {
  const measured = receipt();
  expect(() => certifyBenchmark(measured)).not.toThrow();
  expect(() => certifyBenchmark({ ...measured, benchmark: measured.benchmark.slice(1) })).toThrow(
    "windows",
  );
  expect(() =>
    certifyBenchmark({
      ...measured,
      benchmark: measured.benchmark.map((row) => ({ ...row, operationsPerSecond: 1 })),
    }),
  ).toThrow("throughput");
  expect(() =>
    certifyBenchmark({
      ...measured,
      benchmark: measured.benchmark.map((row) => ({
        ...row,
        latency: { ...row.latency, p99Millis: 100_000 },
      })),
    }),
  ).toThrow("latency");
  expect(() =>
    certifyBenchmark({
      ...measured,
      benchmark: measured.benchmark.map((row) => ({ ...row, queueWaitMeanMillis: null })),
    }),
  ).toThrow("queue wait");
});

it("does not certify short calibration soaks or resource growth", () => {
  const measured = receipt();
  expect(() => certifySoak(measured)).toThrow("Missing soak");
  const soak = {
    elapsedMillis: 30_000,
    cycles: 1000,
    samples: [
      {
        elapsedMillis: 1,
        cycles: 10,
        heapUsedBytes: 1024,
        rssBytes: 1024,
        sockets: 0,
        timeouts: 0,
      },
    ],
    heapGrowthBytes: 0,
    retainedHeapSlopeBytesPerSecond: 0,
    resourceGrowth: 0,
    checks: ["joined-scope-cleanup"],
  } satisfies NonNullable<Receipt["soak"]>;
  expect(() => certifySoak({ ...measured, soak })).toThrow("duration");
  const samples: NonNullable<Receipt["soak"]>["samples"] = [
    soak.samples[0],
    ...Array.from({ length: budgets.minimumSamples }, (_, index) => ({
      cycles: 10,
      heapUsedBytes: 1024,
      rssBytes: 1024,
      sockets: 0,
      timeouts: 0,
      elapsedMillis: index * 1000,
    })),
  ];
  expect(() =>
    certifySoak({
      ...measured,
      soak: { ...soak, elapsedMillis: budgets.soakMillis, samples, resourceGrowth: 1 },
    }),
  ).toThrow("handles");
});
