import { Schema } from "effect";

const NonNegative = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3_600_000 }));
export const Input = Schema.Struct({
  mode: Schema.Literals(["benchmark", "soak"]),
  engine: Schema.Literals(["redis", "valkey"]),
  transport: Schema.Literals(["tcp", "tls", "http"]),
  config: Schema.Unknown,
  http: Schema.optionalKey(
    Schema.Struct({ url: Schema.NonEmptyString, token: Schema.NonEmptyString }),
  ),
  prefix: Schema.String.check(Schema.isPattern(/^effect-kit:hardening:[a-f0-9-]{36}:$/)),
  windowMillis: Positive,
  windows: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  soakMillis: Positive,
});
export type Input = typeof Input.Type;

const Measurement = Schema.Struct({
  count: Positive,
  p50Millis: NonNegative,
  p95Millis: NonNegative,
  p99Millis: NonNegative,
  maximumMillis: NonNegative,
});
export const BenchmarkRow = Schema.Struct({
  workload: Schema.NonEmptyString,
  concurrency: Positive,
  commandsPerOperation: Positive,
  payloadBytes: Schema.Int,
  elapsedMillis: NonNegative,
  operationsPerSecond: NonNegative,
  commandsPerSecond: NonNegative,
  latency: Measurement,
  cpuMillis: NonNegative,
  cpuUtilization: NonNegative,
  heapUsedBytes: NonNegative,
  rssBytes: NonNegative,
  gcMillis: Schema.NullOr(NonNegative),
  queueWaitMeanMillis: Schema.NullOr(NonNegative),
});
export type BenchmarkRow = typeof BenchmarkRow.Type;

export const MemorySample = Schema.Struct({
  elapsedMillis: NonNegative,
  cycles: Schema.Int,
  heapUsedBytes: NonNegative,
  rssBytes: NonNegative,
  sockets: Schema.NullOr(Schema.Int),
  timeouts: Schema.NullOr(Schema.Int),
});
export type MemorySample = typeof MemorySample.Type;

export const Receipt = Schema.Struct({
  runtime: Schema.Literals(["node", "bun"]),
  runtimeVersion: Schema.NonEmptyString,
  platform: Schema.NonEmptyString,
  architecture: Schema.NonEmptyString,
  engine: Schema.NonEmptyString,
  transport: Schema.NonEmptyString,
  protocol: Schema.NonEmptyString,
  rttMillis: NonNegative,
  benchmark: Schema.Array(BenchmarkRow),
  postCleanup: Schema.Struct({
    heapUsedBytes: NonNegative,
    rssBytes: NonNegative,
    externalBytes: NonNegative,
    arrayBufferBytes: NonNegative,
  }),
  soak: Schema.optionalKey(
    Schema.Struct({
      elapsedMillis: NonNegative,
      cycles: Positive,
      samples: Schema.NonEmptyArray(MemorySample),
      heapGrowthBytes: Schema.Number,
      retainedHeapSlopeBytesPerSecond: Schema.Number,
      resourceGrowth: Schema.NullOr(Schema.Int),
      checks: Schema.NonEmptyArray(Schema.NonEmptyString),
    }),
  ),
});
export type Receipt = typeof Receipt.Type;
