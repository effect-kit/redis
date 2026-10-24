import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  test: {
    environment: "node",
    include: ["test/integration/node/**/*.test.ts"],
    passWithNoTests: false,
    fileParallelism: false,
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
