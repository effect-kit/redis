import { monitorEventLoopDelay, PerformanceObserver } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";

import { Duration, Effect } from "effect";

import type { Operation } from "#test/runners/benchmarks/Operation";
import type { Input } from "#test/runners/benchmarks/Options";
import { workloads } from "#test/runners/benchmarks/Options";
import { Latencies } from "#test/support/hardening/Statistics";

export const measure = async (input: Input, operation: Operation, millis: number) => {
  const workload = workloads.find((candidate) => candidate.name === input.workload);
  if (workload === undefined) throw new Error("Missing benchmark workload");

  // Exact samples are bounded. Overflow fails rather than sampling away slow replies.
  const latencies = new Latencies(2_000_000);
  const commandLatencies = new Latencies(2_000_000);
  const effectLatencies = input.latencyClock === "effect" ? new Latencies(2_000_000) : undefined;
  if (effectLatencies !== undefined && input.execution !== "effect")
    throw new Error("Effect timing requires the Effect execution lane");
  const timed = effectLatencies === undefined ? undefined : Effect.timed(operation.effect);
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
  let workloadElapsedMillis = 0;

  try {
    if (input.execution === "effect") {
      await Effect.runPromise(
        Effect.gen(function* () {
          // This clock is inside the program; the outer window also includes its runner edge.
          const workloadStarted = performance.now();
          const deadline = workloadStarted + millis;
          yield* Effect.all(
            Array.from({ length: workload.concurrency }, () =>
              Effect.gen(function* () {
                while (performance.now() < deadline) {
                  const began = performance.now();
                  let reply: unknown;
                  let effectMillis: number | undefined;
                  if (timed === undefined) reply = yield* operation.effect;
                  else {
                    const [duration, value] = yield* timed;
                    effectMillis = Duration.toMillis(duration);
                    reply = value;
                  }

                  const commandMillis = performance.now() - began;
                  operation.verify(reply);
                  const verifiedMillis = performance.now() - began;
                  commandLatencies.add(commandMillis);
                  latencies.add(verifiedMillis);
                  if (effectMillis !== undefined) effectLatencies?.add(effectMillis);
                }
              }),
            ),
            { concurrency: workload.concurrency, discard: true },
          );
          workloadElapsedMillis = performance.now() - workloadStarted;
        }),
      );
    } else {
      let failed = false;
      const workloadStarted = performance.now();
      const deadline = workloadStarted + millis;
      // Join every worker before returning a failure; remaining requests must not leak into cleanup.
      const results = await Promise.allSettled(
        Array.from({ length: workload.concurrency }, async () => {
          try {
            // oxlint-disable-next-line no-unmodified-loop-condition -- Another concurrent worker sets this flag on failure.
            while (!failed && performance.now() < deadline) {
              const began = performance.now();
              // oxlint-disable-next-line no-await-in-loop -- One closed-loop caller has one outstanding request.
              const reply = await operation.promise();
              const commandMillis = performance.now() - began;
              operation.verify(reply);
              const verifiedMillis = performance.now() - began;
              commandLatencies.add(commandMillis);
              latencies.add(verifiedMillis);
            }
          } catch (cause) {
            failed = true;
            throw cause;
          }
        }),
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      workloadElapsedMillis = performance.now() - workloadStarted;
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
      workloadElapsedMillis,
      workloadOperationsPerSecond: (latency.count * 1000) / workloadElapsedMillis,
      workloadCommandsPerSecond: (latency.count * workload.commands * 1000) / workloadElapsedMillis,
      latency,
      commandLatency: commandLatencies.result(),
      ...(effectLatencies === undefined ? {} : { effectLatency: effectLatencies.result() }),
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
