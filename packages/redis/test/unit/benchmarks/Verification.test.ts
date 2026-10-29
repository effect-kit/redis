import { expect, it } from "vitest";

import { small, verifyReply } from "#test/runners/benchmarks/Operation";
import type { Input } from "#test/runners/benchmarks/Options";

const input: Input = {
  client: "effect-redis",
  execution: "effect",
  workload: "get-256b-c1",
  port: 1,
  prefix: "test:",
  warmupMillis: 100,
  sampleMillis: 100,
};

it("rejects fast but incorrect GETs and partial/error batches", () => {
  const get = verifyReply(input);
  expect(() => get(small)).not.toThrow();
  expect(() => get(Buffer.alloc(256, 98))).toThrow();
  expect(() => get("a".repeat(256))).toThrow();

  for (const workload of ["pipeline-32-c4", "batch-32-c4", "compiled-32-c4"] as const) {
    const batch = verifyReply({ ...input, workload });
    expect(() => batch(Array.from({ length: 32 }, () => small))).not.toThrow();
    expect(() => batch([small])).toThrow();
    expect(() => batch(Array.from({ length: 32 }, () => new Error("server error")))).toThrow();
  }
});
