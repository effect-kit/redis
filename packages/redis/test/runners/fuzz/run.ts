import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// An external deadline can stop a synchronous parser loop that a test timer cannot.
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./worker.ts", import.meta.url))],
  {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    encoding: "utf8",
  },
);

if (result.status !== 0 || result.error !== undefined) {
  process.stderr.write(
    result.stderr || String(result.error ?? `Fuzz worker exited ${result.status}`),
  );
  process.exitCode = 1;
} else process.stdout.write(result.stdout);
