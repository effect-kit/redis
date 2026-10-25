import { defineConfig } from "vitest/config";

const mode = process.env.EFFECT_REDIS_TEST_MODE;
if (mode !== undefined && !["containers", "binary", "endpoint"].includes(mode))
  throw new Error("Unknown live test mode; use pnpm test:live for validated options");

const live = mode !== undefined;
const engine = process.env.EFFECT_REDIS_TEST_ENGINE ?? "all";

const engineFiles: Record<string, ReadonlyArray<string>> = {
  core: ["Socket", "Tls", "Lifecycle"],
  redis: ["Backends", "Servers", "Connection", "ConnectionFaults", "Commands", "CommandOptions"],
  valkey: ["Backends", "Connection", "ConnectionFaults", "Commands", "CommandOptions"],
};

const liveFiles =
  mode === "endpoint"
    ? ["test/integration/local/Endpoint.test.ts"]
    : mode === "binary"
      ? ["test/integration/local/Binary.test.ts"]
      : engine === "all"
        ? ["test/integration/node/*.test.ts"]
        : (engineFiles[engine] ?? ["Backends", "Connection"]).map(
            (name) => `test/integration/node/${name}.test.ts`,
          );

// Only the live CLI sets a mode; ordinary pnpm test never acquires external fixtures.
export default defineConfig({
  envDir: false,
  test: {
    environment: "node",
    include: live ? liveFiles : ["test/**/*.test.ts"],
    exclude: live ? [] : ["test/integration/**"],
    passWithNoTests: false,
    testTimeout: live ? 45_000 : 5000,
    hookTimeout: live ? 45_000 : 5000,
    ...(live
      ? {
          fileParallelism: false,
          reporters: ["default", "junit", "json"],
          outputFile: { junit: "test-results/live.xml", json: "test-results/live.json" },
        }
      : {}),
  },
});
