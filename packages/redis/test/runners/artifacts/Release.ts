import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { artifactCommand } from "#test/runners/artifacts/Command";
import { checkConsumers } from "#test/runners/artifacts/Consumers";
import {
  packageRoot,
  readReleaseArchive,
  releaseOptions,
  workspaceRoot,
} from "#test/runners/artifacts/ReleaseArchive";

const options = releaseOptions();
const candidate = await readReleaseArchive(options["pack-dir"]);
const scratch = await mkdtemp(join(tmpdir(), "effect-kit-release-"));

try {
  const consumers = await checkConsumers(
    candidate.archive,
    scratch,
    packageRoot,
    workspaceRoot,
    true,
  );
  const evidence = {
    observedAt: new Date().toISOString(),
    commit: artifactCommand("git", ["rev-parse", "HEAD"], workspaceRoot).trim(),
    workingTreeClean:
      artifactCommand("git", ["status", "--porcelain"], workspaceRoot).trim() === "",
    ...candidate,
    consumers,
  };

  await writeFile(
    join(options["pack-dir"], "verification.json"),
    JSON.stringify(evidence, null, 2),
  );

  process.stdout.write(`Release archive verified: ${candidate.name}@${candidate.version}\n`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
