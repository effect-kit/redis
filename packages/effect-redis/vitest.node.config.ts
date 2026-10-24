import { defineConfig } from "vitest/config";

const engine = process.env.EFFECT_REDIS_TEST_ENGINE ?? "all";
const files =
  engine === "all"
    ? ["**/*.test.ts"]
    : engine === "core"
      ? ["Socket.test.ts", "Tls.test.ts", "Lifecycle.test.ts"]
      : engine === "redis"
        ? ["Backends.test.ts", "Servers.test.ts"]
        : ["Backends.test.ts"];

export default defineConfig({
  envDir: false,
  test: {
    environment: "node",
    include:
      process.env.EFFECT_REDIS_TEST_MODE === "endpoint"
        ? ["test/integration/local/Endpoint.test.ts"]
        : process.env.EFFECT_REDIS_TEST_MODE === "binary"
          ? ["test/integration/local/Binary.test.ts"]
          : files.map((file) => `test/integration/node/${file}`),
    reporters: ["default", "junit", "json"],
    outputFile: { junit: "test-results/live.xml", json: "test-results/live.json" },
    passWithNoTests: false,
    fileParallelism: false,
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
