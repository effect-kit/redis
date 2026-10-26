import { PerformanceObserver } from "node:perf_hooks";

import { Effect } from "effect";

import { RedisTelemetry } from "@effect-kit/redis";
import type { ConnectionSnapshot } from "@effect-kit/redis";

import type { Workload } from "#test/runners/hardening/Workloads";
import type { BenchmarkRow } from "#test/support/hardening/Contract";
import { Latencies } from "#test/support/hardening/Statistics";

export const measure = Effect.fnUntraced(function* (
  workload: Workload,
  millis: number,
  snapshot?: Effect.Effect<ConnectionSnapshot>,
) {
  const gcSupported = typeof Bun === "undefined";
  let gcMillis = 0;
  const started = performance.now();
  const deadline = started + millis;
  const observer = gcSupported
    ? new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries())
          if (entry.startTime >= started && entry.startTime <= deadline) gcMillis += entry.duration;
      })
    : undefined;
  const latencies = new Latencies();
  const before = snapshot === undefined ? undefined : yield* snapshot;
  const cpu = process.cpuUsage();

  yield* Effect.acquireUseRelease(
    Effect.sync(() => observer?.observe({ entryTypes: ["gc"] })),
    () =>
      Effect.all(
        Array.from({ length: workload.concurrency }, () =>
          Effect.gen(function* () {
            while (performance.now() < deadline) {
              const began = performance.now();
              yield* workload.run;
              latencies.add(performance.now() - began);
            }
          }),
        ),
        { concurrency: workload.concurrency },
      ).pipe(
        Effect.provide(
          RedisTelemetry.layer({
            metrics: workload.telemetry !== "disabled",
            tracing: workload.telemetry === "tracing",
          }),
        ),
      ),
    () =>
      Effect.sync(() => {
        for (const entry of observer?.takeRecords() ?? []) gcMillis += entry.duration;
        observer?.disconnect();
      }),
  );
  const elapsedMillis = performance.now() - started;
  const elapsedCpu = process.cpuUsage(cpu);
  const cpuMillis = (elapsedCpu.user + elapsedCpu.system) / 1000;
  const after = snapshot === undefined ? undefined : yield* snapshot;
  const latency = latencies.result();
  const memory = process.memoryUsage();
  const admitted =
    before === undefined || after === undefined ? 0 : after.admitted - before.admitted;

  return {
    workload: workload.name,
    concurrency: workload.concurrency,
    commandsPerOperation: workload.commands,
    payloadBytes: workload.payloadBytes,
    elapsedMillis,
    operationsPerSecond: (latency.count / elapsedMillis) * 1000,
    commandsPerSecond: ((latency.count * workload.commands) / elapsedMillis) * 1000,
    latency,
    cpuMillis,
    cpuUtilization: cpuMillis / elapsedMillis,
    heapUsedBytes: memory.heapUsed,
    rssBytes: memory.rss,
    gcMillis: observer === undefined ? null : gcMillis,
    queueWaitMeanMillis:
      admitted === 0 || before === undefined || after === undefined
        ? null
        : (after.queueWaitMillis - before.queueWaitMillis) / admitted,
  } satisfies BenchmarkRow;
});
