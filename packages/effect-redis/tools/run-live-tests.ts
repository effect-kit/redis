import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

import { liveOptions } from "./LiveOptions.ts";

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
rmSync(new URL("../test-results/", import.meta.url), { recursive: true, force: true });
for (const args of [
  ["run", "build"],
  ["exec", "vitest", "run", "--config", "vitest.node.config.ts"],
]) {
  const result = spawnSync("pnpm", args, { stdio: "inherit", env });
  if (result.error || result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
