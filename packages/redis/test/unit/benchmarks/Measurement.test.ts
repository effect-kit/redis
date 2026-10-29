import { Effect } from "effect";

import { expect, it, vi } from "vitest";

import { measure } from "#test/runners/benchmarks/Measurement";
import type { Operation } from "#test/runners/benchmarks/Operation";
import type { Input } from "#test/runners/benchmarks/Options";

const input: Input = {
  client: "ioredis",
  execution: "promise",
  workload: "get-256b-c32",
  port: 1,
  prefix: "test:",
  warmupMillis: 100,
  sampleMillis: 100,
};

it("joins outstanding Promise workers before propagating a failed measurement", async () => {
  let active = 0;
  let started = 0;
  const operation: Operation = {
    effect: Effect.void,
    promise: () => {
      started++;
      if (started === 1) return Promise.reject(new Error("request failed"));
      active++;
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          active--;
          resolve();
        }, 10),
      );
    },
    verify: () => {},
    close: async () => {},
    settings: {},
  };

  await expect(measure(input, operation, 100)).rejects.toThrow("request failed");
  expect(started).toBe(32);
  expect(active).toBe(0);
});

it("propagates incorrect replies instead of counting them as fast successful operations", async () => {
  const operation: Operation = {
    effect: Effect.succeed("invalid"),
    promise: async () => "invalid",
    verify: () => {
      throw new Error("incorrect reply");
    },
    close: async () => {},
    settings: {},
  };

  await expect(measure({ ...input, execution: "effect" }, operation, 100)).rejects.toThrow(
    "incorrect reply",
  );
});

it("separates command completion, verification and the in-program workload window", async () => {
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  const operation: Operation = {
    effect: Effect.sync(() => {
      now += 2;
      return "reply";
    }),
    promise: async () => "reply",
    verify: () => {
      now += 5;
    },
    close: async () => {},
    settings: {},
  };

  try {
    const measured = await measure(
      { ...input, execution: "effect", workload: "get-256b-c1" },
      operation,
      10,
    );

    expect(measured.commandLatency).toMatchObject({ count: 2, p99Millis: 2 });
    expect(measured.latency).toMatchObject({ count: 2, p99Millis: 7 });
    expect(measured.workloadElapsedMillis).toBe(14);
    expect(measured.elapsedMillis).toBeGreaterThanOrEqual(measured.workloadElapsedMillis);
  } finally {
    clock.mockRestore();
  }
});

it("cross-checks operation elapsed time inside Effect without changing reply counts", async () => {
  const operation: Operation = {
    effect: Effect.sleep(1).pipe(Effect.as("reply")),
    promise: async () => "reply",
    verify: (reply) => expect(reply).toBe("reply"),
    close: async () => {},
    settings: {},
  };

  const measured = await measure(
    { ...input, execution: "effect", workload: "get-256b-c1", latencyClock: "effect" },
    operation,
    10,
  );

  expect(measured.effectLatency?.count).toBe(measured.operations);
  expect(measured.commandLatency.count).toBe(measured.operations);
  expect(measured.effectLatency?.p50Millis).toBeGreaterThan(0);
});
