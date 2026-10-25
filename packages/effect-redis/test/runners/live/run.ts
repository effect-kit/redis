import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { liveOptions } from "#test/runners/live/Options";

const options = liveOptions(
  process.argv.slice(2).filter((arg) => arg !== "--"),
  process.env,
);

const env = {
  ...process.env,
  EFFECT_REDIS_TEST_ENGINE: options.engine,
  EFFECT_REDIS_TEST_MODE: options.mode,
  ...(options.binary === undefined ? {} : { EFFECT_REDIS_TEST_BINARY: options.binary }),
};

rmSync(new URL("../../results/", import.meta.url), { recursive: true, force: true });

for (const args of [
  ["run", "build"],
  ["exec", "vitest", "run", "--config", "test/vitest.live.config.ts"],
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
