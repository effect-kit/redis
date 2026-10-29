import { Schema } from "effect";

import { Client, Execution, WorkloadName } from "#test/runners/benchmarks/Options";

const nonnegative = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const positive = Schema.Number.check(Schema.isGreaterThan(0));
const count = Schema.Int.check(Schema.isGreaterThan(0));

export const Receipt = Schema.Struct({
  client: Client,
  version: Schema.NonEmptyString,
  execution: Execution,
  workload: WorkloadName,
  node: Schema.NonEmptyString,
  settings: Schema.Record(
    Schema.String,
    Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
  ),
  measurement: Schema.Struct({
    elapsedMillis: positive,
    operations: count,
    commands: count,
    operationsPerSecond: positive,
    commandsPerSecond: positive,
    latency: Schema.Struct({
      count,
      p50Millis: nonnegative,
      p95Millis: nonnegative,
      p99Millis: nonnegative,
      maximumMillis: nonnegative,
    }),
    cpuMillis: nonnegative,
    cpuCores: nonnegative,
    baselineRssBytes: positive,
    peakRssBytes: positive,
    heapUsedBytes: positive,
    gcMillis: nonnegative,
    eventLoopP99Millis: Schema.NullOr(nonnegative),
  }),
});
export type Receipt = typeof Receipt.Type;

export interface Cell {
  readonly engine: string;
  readonly trial: number;
  readonly receipt: Receipt;
}

export const cellId = (cell: Cell) =>
  `${cell.engine}/${cell.receipt.execution}/${cell.receipt.workload}/${cell.trial}/${cell.receipt.client}`;

const median = (values: ReadonlyArray<number>) => {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined) throw new Error("Empty benchmark group");
  return sorted.length % 2 === 0 && lower !== undefined ? (lower + upper) / 2 : upper;
};

/** A failed or missing trial must never become an apparently successful aggregate. */
export const summarize = (cells: ReadonlyArray<Cell>, expected: ReadonlyArray<string>) => {
  const ids = cells.map(cellId);
  if (
    expected.length === 0 ||
    new Set(expected).size !== expected.length ||
    new Set(ids).size !== ids.length ||
    JSON.stringify(ids.toSorted()) !== JSON.stringify(expected.toSorted())
  )
    throw new Error("Incomplete or duplicated benchmark matrix");

  const groups = new Map<string, Cell[]>();
  for (const cell of cells) {
    const key = `${cell.engine}/${cell.receipt.execution}/${cell.receipt.workload}/${cell.receipt.client}`;
    const group = groups.get(key) ?? [];
    group.push(cell);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    if (first === undefined) throw new Error("Empty benchmark group");
    const measurements = group.map((cell) => cell.receipt.measurement);
    if (group.some((cell) => cell.receipt.version !== first.receipt.version))
      throw new Error("Client version changed during benchmark");

    return {
      engine: first.engine,
      execution: first.receipt.execution,
      workload: first.receipt.workload,
      client: first.receipt.client,
      version: first.receipt.version,
      trials: group.length,
      medianOperationsPerSecond: median(measurements.map((value) => value.operationsPerSecond)),
      medianCommandsPerSecond: median(measurements.map((value) => value.commandsPerSecond)),
      minCommandsPerSecond: Math.min(...measurements.map((value) => value.commandsPerSecond)),
      maxCommandsPerSecond: Math.max(...measurements.map((value) => value.commandsPerSecond)),
      medianP50Millis: median(measurements.map((value) => value.latency.p50Millis)),
      medianP95Millis: median(measurements.map((value) => value.latency.p95Millis)),
      medianP99Millis: median(measurements.map((value) => value.latency.p99Millis)),
      medianCpuCores: median(measurements.map((value) => value.cpuCores)),
      maxRssBytes: Math.max(...measurements.map((value) => value.peakRssBytes)),
      medianGcMillis: median(measurements.map((value) => value.gcMillis)),
    };
  });
};

export const summaryCsv = (rows: ReturnType<typeof summarize>) => {
  const first = rows[0];
  if (first === undefined) throw new Error("Empty benchmark summary");
  return `${Object.keys(first).join(",")}\n${rows.map((row) => Object.values(row).join(",")).join("\n")}\n`;
};
