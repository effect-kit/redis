import { parseArgs } from "node:util";

import { Schema } from "effect";

export const clients = ["effect-redis", "ioredis", "node-redis", "valkey-glide"] as const;
export const executions = ["effect", "promise"] as const;
export const workloads = [
  { name: "get-256b-c1", concurrency: 1, commands: 1 },
  { name: "get-256b-c32", concurrency: 32, commands: 1 },
  { name: "get-64k-c8", concurrency: 8, commands: 1 },
  { name: "set-256b-c16", concurrency: 16, commands: 1 },
  { name: "incr-c16", concurrency: 16, commands: 1 },
  { name: "pipeline-32-c4", concurrency: 4, commands: 32 },
  { name: "transaction-8-c1", concurrency: 1, commands: 8 },
] as const;

export const Client = Schema.Literals(clients);
export type Client = typeof Client.Type;
export const Execution = Schema.Literals(executions);
export const WorkloadName = Schema.Literals(workloads.map((workload) => workload.name));

const bounded = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));

export const Input = Schema.Struct({
  client: Client,
  execution: Execution,
  workload: WorkloadName,
  port: bounded(1, 65535),
  prefix: Schema.NonEmptyString,
  warmupMillis: bounded(100, 60_000),
  sampleMillis: bounded(100, 60_000),
});
export type Input = typeof Input.Type;

const Settings = Schema.Struct({
  engine: Schema.Literals(["redis", "valkey", "all"]),
  execution: Schema.Literals(["effect", "promise", "all"]),
  client: Schema.Literals([...clients, "all"]),
  workload: Schema.Literals([...workloads.map((workload) => workload.name), "all"]),
  trials: bounded(1, 10),
  warmupMillis: bounded(100, 60_000),
  sampleMillis: bounded(100, 60_000),
});

export const benchmarkOptions = (args: ReadonlyArray<string>) => {
  const { values } = parseArgs({
    args: args.filter((arg) => arg !== "--"),
    options: {
      engine: { type: "string", default: "all" },
      execution: { type: "string", default: "effect" },
      client: { type: "string", default: "all" },
      workload: { type: "string", default: "all" },
      trials: { type: "string", default: "3" },
      "warmup-ms": { type: "string", default: "1000" },
      "sample-ms": { type: "string", default: "2000" },
    },
  });

  return Schema.decodeUnknownSync(Settings)({
    ...values,
    trials: Number(values.trials),
    warmupMillis: Number(values["warmup-ms"]),
    sampleMillis: Number(values["sample-ms"]),
  });
};

/** Balance first/last positions across trials without irreproducible random ordering. */
export const rotateClients = (selected: ReadonlyArray<Client>, trial: number) => {
  const offset = trial % selected.length;
  return [...selected.slice(offset), ...selected.slice(0, offset)];
};
