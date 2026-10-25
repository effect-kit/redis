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
    ],
    passWithNoTests: false,
    testTimeout: 5000,
    hookTimeout: 5000,
  },
});
