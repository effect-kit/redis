import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { selectedEngine } from "#test/support/servers/Targets";

const mode = process.env.EFFECT_REDIS_TEST_MODE ?? "containers";
if (!["containers", "binary", "endpoint"].includes(mode))
  throw new Error("Unknown live test mode; use pnpm test:live for validated options");

const backend = (name: string) => `test/integration/backends/${name}.test.ts`;
const commandFiles = "test/e2e/commands/*.test.ts";
const streamFiles = "test/e2e/streams/*.test.ts";
const sessionFiles = "test/e2e/sessions/*.test.ts";
const subscriptionFiles = "test/e2e/subscriptions/*.test.ts";

const engineFiles: Readonly<Record<string, ReadonlyArray<string>>> = {
  all: [
    "test/integration/transport/node/*.test.ts",
    "test/integration/backends/*.test.ts",
    commandFiles,
    sessionFiles,
    streamFiles,
    subscriptionFiles,
  ],
  core: ["test/integration/transport/node/*.test.ts"],
  redis: [
    "test/integration/backends/*.test.ts",
    commandFiles,
    sessionFiles,
    streamFiles,
    subscriptionFiles,
  ],
  valkey: [
    backend("Transport"),
    backend("Connection"),
    backend("Recovery"),
    commandFiles,
    sessionFiles,
    streamFiles,
    subscriptionFiles,
  ],
};

const containerFiles = engineFiles[selectedEngine] ?? [backend("Transport"), backend("Connection")];

const include =
  mode === "endpoint"
    ? ["test/e2e/smoke/Endpoint.test.ts"]
    : mode === "binary"
      ? ["test/e2e/smoke/Binary.test.ts"]
      : containerFiles;

export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  envDir: false,
  test: {
    environment: "node",
    include: [...include],
    passWithNoTests: false,
    testTimeout: 45_000,
    hookTimeout: 45_000,
    fileParallelism: false,
    reporters: ["default", "junit", "json"],
    outputFile: { junit: "test/results/live.xml", json: "test/results/live.json" },
  },
});
