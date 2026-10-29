import { expect, it } from "vitest";

import { cellId, summarize } from "#test/runners/benchmarks/Results";
import type { Cell } from "#test/runners/benchmarks/Results";

const cell = (trial: number, operationsPerSecond: number): Cell => ({
  engine: "redis",
  trial,
  receipt: {
    client: "effect-redis",
    version: "0.1.0",
    execution: "effect",
    workload: "pipeline-32-c4",
    node: "24.22.0",
    settings: {},
    measurement: {
      elapsedMillis: 1000,
      operations: operationsPerSecond,
      commands: operationsPerSecond * 32,
      operationsPerSecond,
      commandsPerSecond: operationsPerSecond * 32,
      workloadElapsedMillis: 999,
      workloadOperationsPerSecond: operationsPerSecond,
      workloadCommandsPerSecond: operationsPerSecond * 32,
      commandLatency: {
        count: operationsPerSecond,
        p50Millis: 0.5,
        p95Millis: 1,
        p99Millis: 2,
        maximumMillis: 3,
      },
      latency: {
        count: operationsPerSecond,
        p50Millis: 1,
        p95Millis: 2,
        p99Millis: 3,
        maximumMillis: 4,
      },
      cpuMillis: 100,
      cpuCores: 0.1,
      baselineRssBytes: 100,
      peakRssBytes: 200,
      heapUsedBytes: 50,
      gcMillis: 0,
      eventLoopP99Millis: null,
    },
  },
});

it("distinguishes batch throughput from command throughput and preserves trial spread", () => {
  const cells = [cell(0, 10), cell(1, 30), cell(2, 20)];
  expect(summarize(cells, cells.map(cellId))).toMatchObject([
    {
      trials: 3,
      medianOperationsPerSecond: 20,
      medianCommandsPerSecond: 640,
      minCommandsPerSecond: 320,
      maxCommandsPerSecond: 960,
      medianP99Millis: 3,
    },
  ]);
});

it("refuses to report missing, duplicate or unexpected measurements as a complete comparison", () => {
  const first = cell(0, 10);
  const second = cell(1, 20);
  const expected = [first, second].map(cellId);

  expect(() => summarize([first], expected)).toThrow("matrix");
  expect(() => summarize([first, first], expected)).toThrow("matrix");
  expect(() => summarize([first, second, cell(2, 30)], expected)).toThrow("matrix");
  expect(() => summarize([], [])).toThrow("matrix");
});
