import { spawnSync } from "node:child_process";

/** Build/pack consumers are owned subprocesses with an external deadline and bounded captured output. */
export const artifactCommand = (
  executable: string,
  args: ReadonlyArray<string>,
  cwd: string,
  timeout = 180_000,
) => {
  const result = spawnSync(executable, [...args], {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Artifact command failed: ${executable}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
