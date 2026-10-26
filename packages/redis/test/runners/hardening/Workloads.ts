import { Effect, Option, Result } from "effect";

import { BatchExecutor, Commands } from "@effect-kit/redis";
import type { RedisClient } from "@effect-kit/redis";

import { ensure } from "#test/runners/providers/scenarios/Assertions";

export interface Workload {
  readonly name: string;
  readonly concurrency: number;
  readonly commands: number;
  readonly payloadBytes: number;
  readonly telemetry: "disabled" | "metrics" | "tracing";
  readonly run: Effect.Effect<unknown, unknown>;
}

export const workloads = Effect.fnUntraced(function* (redis: RedisClient, prefix: string) {
  const batches = yield* BatchExecutor;
  const small = new Uint8Array(256).fill(97);
  const large = new Uint8Array(64 * 1024).fill(98);
  yield* redis.set(`${prefix}small`, small);
  yield* redis.set(`${prefix}large`, large);
  yield* redis.set(`${prefix}counter`, "0");
  yield* redis.hset(`${prefix}hash`, [
    ["field-0", "x".repeat(64)],
    ...Array.from({ length: 15 }, (_, index) => [`field-${index + 1}`, "x".repeat(64)] as const),
  ]);

  const read = (key: string, size: number) =>
    redis
      .getBytes(key)
      .pipe(
        Effect.tap((value) =>
          Effect.sync(() =>
            ensure(Option.isSome(value) && value.value.length === size, "benchmark-payload"),
          ),
        ),
      );
  const pipeline = redis
    .pipeline(Array.from({ length: 32 }, () => Commands.getBytes(`${prefix}small`)))
    .pipe(
      Effect.provideService(BatchExecutor, batches),
      Effect.tap((results) =>
        Effect.sync(() =>
          ensure(
            results.length === 32 &&
              results.every(
                (result) =>
                  Result.isSuccess(result) &&
                  Option.isSome(result.success) &&
                  result.success.value.length === 256,
              ),
            "benchmark-pipeline",
          ),
        ),
      ),
    );
  return [
    {
      name: "get-256b-c1",
      concurrency: 1,
      commands: 1,
      payloadBytes: 256,
      telemetry: "disabled",
      run: read(`${prefix}small`, 256),
    },
    {
      name: "get-256b-c32",
      concurrency: 32,
      commands: 1,
      payloadBytes: 256,
      telemetry: "disabled",
      run: read(`${prefix}small`, 256),
    },
    {
      name: "get-64k-c8",
      concurrency: 8,
      commands: 1,
      payloadBytes: 65536,
      telemetry: "disabled",
      run: read(`${prefix}large`, 65536),
    },
    {
      name: "set-256b-c16",
      concurrency: 16,
      commands: 1,
      payloadBytes: 256,
      telemetry: "disabled",
      run: redis.set(`${prefix}write`, small),
    },
    {
      name: "incr-c16",
      concurrency: 16,
      commands: 1,
      payloadBytes: 0,
      telemetry: "disabled",
      run: redis.incr(`${prefix}counter`),
    },
    {
      name: "hgetall-16-c8",
      concurrency: 8,
      commands: 1,
      payloadBytes: 1024,
      telemetry: "disabled",
      run: redis
        .hgetall(`${prefix}hash`)
        .pipe(
          Effect.tap((value) => Effect.sync(() => ensure(value.length === 16, "benchmark-hash"))),
        ),
    },
    {
      name: "xadd-256b-c8",
      concurrency: 8,
      commands: 1,
      payloadBytes: 256,
      telemetry: "disabled",
      run: redis.xadd(`${prefix}stream`, "*", [["body", small]], {
        trim: { by: "MAXLEN", threshold: 1024 },
      }),
    },
    {
      name: "pipeline-32-c4",
      concurrency: 4,
      commands: 32,
      payloadBytes: 8192,
      telemetry: "disabled",
      run: pipeline,
    },
    {
      name: "get-metrics-c32",
      concurrency: 32,
      commands: 1,
      payloadBytes: 256,
      telemetry: "metrics",
      run: read(`${prefix}small`, 256),
    },
    {
      name: "get-tracing-c32",
      concurrency: 32,
      commands: 1,
      payloadBytes: 256,
      telemetry: "tracing",
      run: read(`${prefix}small`, 256),
    },
  ] satisfies ReadonlyArray<Workload>;
});
