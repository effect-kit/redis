import { expect, it } from "vitest";

import { heapSlope, Latencies } from "#test/support/hardening/Statistics";

it("measures exact nearest-rank tail latency and rejects empty/overflow samples", () => {
  const samples = new Latencies(100);
  expect(() => samples.result()).toThrow();
  for (let value = 100; value >= 1; value--) samples.add(value);
  expect(samples.result()).toEqual({
    count: 100,
    p50Millis: 50,
    p95Millis: 95,
    p99Millis: 99,
    maximumMillis: 100,
  });
  expect(() => samples.add(101)).toThrow();
  expect(() => new Latencies().add(Number.NaN)).toThrow();
});

it("distinguishes flat retained heaps from accumulating memory using elapsed seconds", () => {
  expect(
    heapSlope([
      { elapsedMillis: 1000, heapUsedBytes: 10 },
      { elapsedMillis: 2000, heapUsedBytes: 10 },
    ]),
  ).toBe(0);
  expect(
    heapSlope([
      { elapsedMillis: 1000, heapUsedBytes: 10 },
      { elapsedMillis: 2000, heapUsedBytes: 20 },
      { elapsedMillis: 3000, heapUsedBytes: 30 },
    ]),
  ).toBe(10);
  expect(() => heapSlope([{ elapsedMillis: 0, heapUsedBytes: 1 }])).toThrow();
});
