import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: false,
    testTimeout: 5000,
    hookTimeout: 5000,
  },
});
