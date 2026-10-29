import { expect, it } from "vitest";

import { keySequence, smallKeys } from "#test/runners/benchmarks/Fixtures";
import { benchmarkOptions, clients, rotateClients } from "#test/runners/benchmarks/Options";

it("keeps native Effect comparisons separate from Promise boundary measurements", () => {
  expect(benchmarkOptions([]).execution).toBe("effect");
  expect(benchmarkOptions([]).sessionConnections).toBe(4);
  expect(benchmarkOptions(["--session-connections", "1"]).sessionConnections).toBe(1);
  expect(
    benchmarkOptions(["--execution", "all", "--engine", "valkey", "--trials", "4"]),
  ).toMatchObject({
    execution: "all",
    engine: "valkey",
    trials: 4,
  });
  const orders = clients.map((_, trial) => rotateClients(clients, trial));
  expect(new Set(orders.map((order) => order[0])).size).toBe(clients.length);
  expect(orders.every((order) => new Set(order).size === clients.length)).toBe(true);
});

it("distinguishes API-call construction and validates Effect-only clock measurements", () => {
  expect(benchmarkOptions(["--construction", "call", "--latency-clock", "effect"])).toMatchObject({
    construction: "call",
    latencyClock: "effect",
  });
  expect(() => benchmarkOptions(["--execution", "promise", "--latency-clock", "effect"])).toThrow(
    "Effect execution lane",
  );

  const keys = smallKeys({
    client: "effect-redis",
    execution: "effect",
    construction: "call",
    workload: "get-256b-c32",
    port: 1,
    prefix: "test:",
    warmupMillis: 100,
    sampleMillis: 100,
  });
  const next = keySequence(keys);
  expect(keys).toHaveLength(4);
  expect(new Set(keys.map((key) => key.length)).size).toBe(1);
  expect(Array.from({ length: 5 }, next)).toEqual([...keys, keys[0]]);
});

it.each([
  ["--engine", "production"],
  ["--client", "unknown"],
  ["--workload", "missing"],
  ["--trials", "0"],
  ["--trials", "1.5"],
  ["--sample-ms", "NaN"],
  ["--warmup-ms", "0"],
  ["--sample-ms", "60001"],
  ["--url", "redis://localhost"],
  ["--session-connections", "0"],
  ["--session-connections", "17"],
])("rejects unsafe or invalid selections before starting fixtures: %j", (...args) => {
  expect(() => benchmarkOptions(args)).toThrow();
});
