import { expect, it } from "vitest";

import { hardeningOptions } from "#test/runners/hardening/Options";

it("selects explicit diagnostic reruns without turning them into release certification", () => {
  const options = hardeningOptions(["soak", "--calibrate", "--case", "soak-redis-node-http"]);
  expect(options.calibration).toBe(true);
  expect(options.includes("soak-redis-node-http")).toBe(true);
  expect(options.includes("soak-redis-node")).toBe(false);
  expect(hardeningOptions([]).includes("readiness-redis")).toBe(true);
});

it.each([
  ["unknown"],
  ["--case"],
  ["--case", "unknown"],
  ["benchmark", "--case", "soak-redis-node"],
  ["--env"],
])("rejects invalid or contradictory selections before fixture acquisition: %j", (...args) => {
  expect(() => hardeningOptions(args)).toThrow();
});
