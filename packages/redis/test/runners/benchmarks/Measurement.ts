import { monitorEventLoopDelay, PerformanceObserver } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";

import { Effect } from "effect";

import type { Operation } from "#test/runners/benchmarks/Operation";
import type { Input } from "#test/runners/benchmarks/Options";
import { workloads } from "#test/runners/benchmarks/Options";
import { Latencies } from "#test/support/hardening/Statistics";

export const measure = async (input: Input, operation: Operation, millis: number) => {
  const workload = workloads.find((candidate) => candidate.name === input.workload);
  if (workload === undefined) throw new Error("Missing benchmark workload");

  // Exact samples are bounded. Overflow fails rather than sampling away slow replies.
  const latencies = new Latencies(2_000_000);
  const delay = monitorEventLoopDelay({ resolution: 10 });
  let gcMillis = 0;
  const gc = new PerformanceObserver((entries) => {
    for (const entry of entries.getEntries()) gcMillis += entry.duration;
  });
  const before = process.memoryUsage();
  let peakRssBytes = before.rss;
  const memoryTimer = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
  }, 25);

  gc.observe({ entryTypes: ["gc"] });
  delay.enable();
  const cpu = process.cpuUsage();
  const started = performance.now();
  const deadline = started + millis;

  try {
    if (input.execution === "effect") {
      await Effect.runPromise(
        Effect.all(
          Array.from({ length: workload.concurrency }, () =>
            Effect.gen(function* () {
              while (performance.now() < deadline) {
                const began = performance.now();
                const reply = yield* operation.effect;
                operation.verify(reply);
                latencies.add(performance.now() - began);
              }
            }),
          ),
          { concurrency: workload.concurrency, discard: true },
        ),
      );
    } else {
      let failed = false;
      // Join every worker before returning a failure; remaining requests must not leak into cleanup.
      const results = await Promise.allSettled(
        Array.from({ length: workload.concurrency }, async () => {
          try {
            // oxlint-disable-next-line no-unmodified-loop-condition -- Another concurrent worker sets this flag on failure.
            while (!failed && performance.now() < deadline) {
              const began = performance.now();
              // oxlint-disable-next-line no-await-in-loop -- One closed-loop caller has one outstanding request.
              const reply = await operation.promise();
              operation.verify(reply);
              latencies.add(performance.now() - began);
            }
          } catch (cause) {
            failed = true;
            throw cause;
          }
        }),
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    }

    const elapsedMillis = performance.now() - started;
    const elapsedCpu = process.cpuUsage(cpu);
    const memory = process.memoryUsage();
    // Let GC performance entries settle before disconnecting the observer.
    await setImmediate();
    for (const entry of gc.takeRecords()) gcMillis += entry.duration;
    const latency = latencies.result();
    const cpuMillis = (elapsedCpu.user + elapsedCpu.system) / 1000;

    return {
      elapsedMillis,
      operations: latency.count,
      commands: latency.count * workload.commands,
      operationsPerSecond: (latency.count * 1000) / elapsedMillis,
      commandsPerSecond: (latency.count * workload.commands * 1000) / elapsedMillis,
      latency,
      cpuMillis,
      cpuCores: cpuMillis / elapsedMillis,
      baselineRssBytes: before.rss,
      peakRssBytes: Math.max(peakRssBytes, memory.rss),
      heapUsedBytes: memory.heapUsed,
      gcMillis,
      eventLoopP99Millis: delay.count === 0 ? null : delay.percentile(99) / 1_000_000,
    };
  } finally {
    clearInterval(memoryTimer);
    delay.disable();
    gc.disconnect();
  }
};
