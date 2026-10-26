import { Effect, Option, Result } from "effect";

import { Commands, Redis, RedisCredentials } from "@effect-kit/redis";

import { collect, resources } from "#test/runners/hardening/Memory";
import { ensure, sameBytes } from "#test/runners/providers/scenarios/Assertions";
import type { Input, MemorySample } from "#test/support/hardening/Contract";
import { heapSlope } from "#test/support/hardening/Statistics";

/** Keep one HTTP service alive under sustained load; scope churn alone can hide retained request state. */
export const httpSoak = Effect.fnUntraced(function* (input: Input) {
  const redis = yield* Redis;
  const credentials = yield* RedisCredentials;
  const payload = new Uint8Array(256).fill(97);
  const key = `${input.prefix}value`;
  const counter = `${input.prefix}counter`;
  const started = performance.now();
  let cycles = 0;
  let lastSample = started;
  let baseline: MemorySample | undefined;
  const samples: MemorySample[] = [];
  const sample = () => {
    collect();
    const usage = process.memoryUsage();
    return {
      elapsedMillis: performance.now() - started,
      cycles,
      heapUsedBytes: usage.heapUsed,
      rssBytes: usage.rss,
      sockets: resources("TCPSocketWrap"),
      timeouts: resources("Timeout"),
    };
  };

  yield* redis.set(key, payload);
  while (performance.now() - started < input.soakMillis || cycles < 12) {
    yield* redis.set(counter, "0");
    yield* Effect.all(
      Array.from({ length: 16 }, () =>
        redis
          .getBytes(key)
          .pipe(
            Effect.tap((reply) =>
              Effect.sync(() =>
                ensure(Option.isSome(reply) && sameBytes(reply.value, payload), "http-soak-bytes"),
              ),
            ),
          ),
      ),
      { concurrency: 16 },
    );
    const pipeline = yield* redis.pipeline([Commands.incr(counter), Commands.getBytes(key)]);
    ensure(
      Result.getOrThrow(pipeline[0]) === 1n && Option.isSome(Result.getOrThrow(pipeline[1])),
      "http-soak-pipeline",
    );
    const transaction = yield* redis.transaction([Commands.incr(counter)]);
    ensure(
      transaction._tag === "Committed" && Result.getOrThrow(transaction.results[0]) === 2n,
      "http-soak-transaction",
    );
    if (cycles % 5 === 0) {
      yield* credentials.rotate;
      const next = yield* redis.pipeline([Commands.incr(counter)]);
      ensure(Result.getOrThrow(next[0]) === 3n, "http-soak-future-rotation");
    }
    cycles++;
    if (cycles >= 10 && (baseline === undefined || performance.now() - lastSample >= 1000)) {
      const observed = sample();
      baseline ??= observed;
      samples.push(observed);
      if (samples.length > 32) samples.shift();
      lastSample = performance.now();
    }
  }
  const final = sample();
  samples.push(final);
  ensure(baseline !== undefined && samples.length >= 2, "http-soak-samples");
  return {
    elapsedMillis: final.elapsedMillis,
    cycles,
    samples: [baseline, ...samples],
    heapGrowthBytes: final.heapUsedBytes - baseline.heapUsedBytes,
    retainedHeapSlopeBytesPerSecond: heapSlope(samples.slice(-16)),
    resourceGrowth:
      final.sockets === null || baseline.sockets === null
        ? null
        : final.sockets + (final.timeouts ?? 0) - baseline.sockets - (baseline.timeouts ?? 0),
    checks: [
      "binary-ownership",
      "bounded-concurrency",
      "pipeline",
      "transaction",
      "explicit-rotation-future-session",
      "post-gc-memory",
      "sustained-http-layer",
    ],
  };
});
