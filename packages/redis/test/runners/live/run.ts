import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { liveOptions } from "#test/runners/live/Options";
import { bunRuntimeImage } from "#test/support/servers/Targets";

const options = liveOptions(
  process.argv.slice(2).filter((arg) => arg !== "--"),
  process.env,
);

const env = {
  ...process.env,
  EFFECT_REDIS_TEST_ENGINE: options.engine,
  EFFECT_REDIS_TEST_MODE: options.mode,
  EFFECT_REDIS_TEST_RUNTIME: options.runtime,
  EFFECT_REDIS_TEST_RUN_ID: randomUUID(),
  ...(options.binary === undefined ? {} : { EFFECT_REDIS_TEST_BINARY: options.binary }),
};

if (options.runtime !== "node") {
  const version = spawnSync("bun", ["--version"], { encoding: "utf8", timeout: 5000 });
  if (version.error || version.status !== 0 || version.stdout.trim() !== bunRuntimeImage.version)
    throw new Error(`Live Bun tests require Bun ${bunRuntimeImage.version}; check .bun-version`);
}

rmSync(new URL("../../results/", import.meta.url), { recursive: true, force: true });

for (const args of [
  ["run", "build"],
  ["exec", "vitest", "run", "--config", "test/vitest.live.config.ts"],
  ...(options.mode === "containers" &&
  options.engine !== "core" &&
  process.env.EFFECT_REDIS_TEST_HTTP_ONLY !== "1"
    ? [["exec", "node", "test/runners/conformance/summarize.ts"]]
    : []),
]) {
  const result = spawnSync("pnpm", args, {
    stdio: "inherit",
    env,
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
  });

  if (result.error || result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
