import { expect, it } from "vitest";

import { benchmarkOptions, clients, rotateClients } from "#test/runners/benchmarks/Options";

it("keeps native Effect comparisons separate from Promise boundary measurements", () => {
  expect(benchmarkOptions([]).execution).toBe("effect");
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
])("rejects unsafe or invalid selections before starting fixtures: %j", (...args) => {
  expect(() => benchmarkOptions(args)).toThrow();
});
