import { Cause, Effect, Option, Redacted } from "effect";

import { Connection, Redis } from "@effect-kit/redis";
import { RedisUpstash } from "@effect-kit/redis/upstash";

import { httpSoak } from "#test/runners/hardening/HttpSoak";
import { measure } from "#test/runners/hardening/Measurement";
import { collect, memory } from "#test/runners/hardening/Memory";
import { benchmarkLayer, nativeAdapter } from "#test/runners/hardening/Native";
import { soak } from "#test/runners/hardening/Soak";
import { workloads } from "#test/runners/hardening/Workloads";
import { readInput, runtime, writeOutput } from "#test/runners/providers/Stdin";
import { Input } from "#test/support/hardening/Contract";
import { safeFailure } from "#test/support/providers/Failures";

try {
  const input = await readInput(Input);
  const host = runtime();
  const adapter = await nativeAdapter();
  const rows = Effect.gen(function* () {
    const redis = yield* Redis;
    const connection = yield* Effect.serviceOption(Connection);
    const snapshot = Option.isSome(connection) ? connection.value.snapshot : undefined;
    const roundTrips = [];
    for (let sample = 0; sample < 20; sample++) {
      const started = performance.now();
      yield* redis.ping();
      roundTrips.push(performance.now() - started);
    }
    const rttMillis = roundTrips.toSorted((left, right) => left - right)[10] ?? 0;
    const benchmark = [];
    for (const workload of yield* workloads(redis, input.prefix)) {
      yield* measure(workload, Math.min(200, input.windowMillis), snapshot);
      for (let window = 0; window < input.windows; window++)
        benchmark.push(yield* measure(workload, input.windowMillis, snapshot));
    }
    return { rttMillis, benchmark };
  });
  const httpLayer =
    input.http === undefined
      ? undefined
      : RedisUpstash.layer({
          url: input.http.url,
          token: Redacted.make(input.http.token),
          allowInsecureLocalhost: true,
          pipelineResponseFormat: "frames",
          maxConcurrentRequests: 64,
        });
  const program =
    input.mode === "soak" && httpLayer === undefined
      ? soak(input, adapter).pipe(
          Effect.map((soaked) => ({ rttMillis: 0, benchmark: [], soak: soaked })),
        )
      : httpLayer === undefined
        ? rows.pipe(Effect.provide(benchmarkLayer(input, adapter)))
        : input.mode === "soak"
          ? httpSoak(input).pipe(
              Effect.map((soaked) => ({ rttMillis: 0, benchmark: [], soak: soaked })),
              Effect.provide(httpLayer),
            )
          : rows.pipe(Effect.provide(httpLayer));
  const exit = await Effect.runPromiseExit(Effect.scoped(program));
  if (exit._tag === "Failure")
    await writeOutput(`${JSON.stringify(safeFailure(Cause.squash(exit.cause)))}\n`, true);
  else {
    collect();
    await writeOutput(
      JSON.stringify({
        runtime: host.name,
        runtimeVersion: host.version,
        platform: process.platform,
        architecture: process.arch,
        engine: input.engine,
        transport: input.transport,
        protocol: input.http === undefined ? "resp3" : "resp2",
        ...exit.value,
        postCleanup: memory(),
      }),
    );
  }
} catch (error) {
  await writeOutput(`${JSON.stringify(safeFailure(error))}\n`, true);
}
