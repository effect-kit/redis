import { Effect } from "effect";

import { expect, it } from "vitest";

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
