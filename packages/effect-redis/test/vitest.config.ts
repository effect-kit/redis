import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  envDir: false,
  test: {
    environment: "node",
    include: [
      "test/unit/**/*.test.ts",
      "test/integration/commands/**/*.test.ts",
      "test/integration/connection/**/*.test.ts",
      "test/integration/sessions/**/*.test.ts",
      "test/integration/streams/**/*.test.ts",
      "test/integration/subscriptions/**/*.test.ts",
      "test/integration/scripting/**/*.test.ts",
      "test/integration/admin/**/*.test.ts",
      "test/integration/diagnostics/**/*.test.ts",
      "test/integration/cluster/**/*.test.ts",
    ],
    passWithNoTests: false,
    testTimeout: 5000,
    hookTimeout: 5000,
  },
});
