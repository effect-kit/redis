import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { selectedProviderCases } from "#test/support/providers/Matrix";
import { selectRuntime } from "#test/support/runtime/Selection";
import { selectedEngine } from "#test/support/servers/Targets";

const mode = process.env.EFFECT_REDIS_TEST_MODE ?? "containers";
const providersOnly = process.env.EFFECT_REDIS_TEST_PROVIDERS === "1";
const providerFiles = providersOnly
  ? [
      ...new Set(
        selectedProviderCases().map((scenario) =>
          scenario.provider === "workers"
            ? "test/e2e/providers/Workers.test.ts"
            : scenario.scenario === "native"
              ? "test/e2e/providers/Native.test.ts"
              : "test/e2e/providers/Http.test.ts",
        ),
      ),
    ]
  : [];
const results = providersOnly
  ? `test/results/providers/${process.env.EFFECT_REDIS_PROVIDER_RUN_ID}`
  : "test/results";
const runtime = selectRuntime(process.env.EFFECT_REDIS_TEST_RUNTIME);
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
    "test/e2e/scripting/*.test.ts",
    "test/e2e/admin/*.test.ts",
    "test/e2e/diagnostics/*.test.ts",
    "test/e2e/cluster/*.test.ts",
    "test/e2e/sentinel/*.test.ts",
    "test/e2e/modules/*.test.ts",
  ],
  core: ["test/integration/transport/node/*.test.ts"],
  redis: [
    "test/integration/backends/*.test.ts",
    commandFiles,
    sessionFiles,
    streamFiles,
    subscriptionFiles,
    "test/e2e/scripting/*.test.ts",
    "test/e2e/admin/*.test.ts",
    "test/e2e/diagnostics/*.test.ts",
    "test/e2e/cluster/*.test.ts",
    "test/e2e/sentinel/*.test.ts",
    "test/e2e/modules/*.test.ts",
  ],
  valkey: [
    backend("Transport"),
    backend("Connection"),
    backend("Recovery"),
    backend("Layers"),
    commandFiles,
    sessionFiles,
    streamFiles,
    subscriptionFiles,
    "test/e2e/scripting/*.test.ts",
    "test/e2e/admin/*.test.ts",
    "test/e2e/diagnostics/*.test.ts",
    "test/e2e/cluster/*.test.ts",
    "test/e2e/sentinel/*.test.ts",
    "test/e2e/modules/*.test.ts",
  ],
};

const containerFiles = engineFiles[selectedEngine] ?? [
  backend("Transport"),
  backend("Connection"),
  backend("Layers"),
];

const nodeFiles =
  mode === "endpoint"
    ? ["test/e2e/smoke/Endpoint.test.ts"]
    : mode === "binary"
      ? ["test/e2e/smoke/Binary.test.ts"]
      : containerFiles;

const bunFiles =
  mode === "endpoint"
    ? ["test/e2e/smoke/BunEndpoint.test.ts"]
    : mode === "binary"
      ? ["test/e2e/smoke/BunBinary.test.ts"]
      : selectedEngine === "core"
        ? ["test/integration/transport/bun/*.test.ts"]
        : selectedEngine === "all"
          ? ["test/integration/transport/bun/*.test.ts", "test/e2e/runtime/bun/*.test.ts"]
          : ["redis", "valkey"].includes(selectedEngine)
            ? ["test/e2e/runtime/bun/*.test.ts"]
            : ["test/e2e/runtime/bun/Smoke.test.ts"];

const include = [
  ...(mode === "containers" && selectedEngine !== "core" ? ["test/e2e/conformance/*.test.ts"] : []),
  ...(runtime === "bun" ? [] : nodeFiles),
  ...(runtime === "node" ? [] : bunFiles),
];

const httpOnly = process.env.EFFECT_REDIS_TEST_HTTP_ONLY === "1";
if (httpOnly && mode !== "containers")
  throw new Error("HTTP fixture selection requires container mode");
const httpFiles =
  mode === "containers" && ["all", "redis", "valkey", "core"].includes(selectedEngine)
    ? [
        ...(runtime === "bun" ? [] : ["test/integration/http/*.test.ts"]),
        ...(selectedEngine === "core"
          ? []
          : [
              "test/e2e/upstash/Runtime.test.ts",
              ...(runtime === "bun"
                ? []
                : [
                    "test/e2e/upstash/Client.test.ts",
                    "test/e2e/upstash/Uncertainty.test.ts",
                    "test/e2e/upstash/Development.test.ts",
                  ]),
            ]),
      ]
    : [];
if (httpOnly && httpFiles.length === 0)
  throw new Error("HTTP Bun cases require --engine all|redis|valkey");

export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  envDir: false,
  test: {
    environment: "node",
    include: providersOnly ? providerFiles : httpOnly ? httpFiles : [...include, ...httpFiles],
    passWithNoTests: false,
    testTimeout: 45_000,
    hookTimeout: 45_000,
    fileParallelism: false,
    reporters: ["default", "junit", "json"],
    outputFile: { junit: `${results}/live.xml`, json: `${results}/live.json` },
  },
});
