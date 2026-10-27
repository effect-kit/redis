import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { artifactCommand } from "#test/runners/artifacts/Command";
import { allowedPackageEntry } from "#test/support/artifacts/Policy";
import {
  archiveIntegrity,
  releasePlan,
  verifyReleaseIntegrity,
} from "#test/support/artifacts/ReleasePlan";

export const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const workspaceRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

export const releaseOptions = (args: ReadonlyArray<string> = process.argv.slice(2)) =>
  parseArgs({
    args: [...args],
    options: {
      "pack-dir": { type: "string", default: join(packageRoot, "test/results/release") },
      provenance: { type: "boolean", default: false },
      "skip-live": { type: "boolean", default: false },
    },
  }).values;

export const readReleaseArchive = async (directory: string) => {
  const metadata: { name: string; version: string } = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  const plan = releasePlan(
    JSON.parse(await readFile(join(directory, "publish-plan.json"), "utf8")),
    metadata.version,
  );
  const archive = join(directory, plan.tarball.path);

  if (!(await lstat(archive)).isFile()) throw new Error("Release archive must be a regular file");

  const bytes = await readFile(archive);
  verifyReleaseIntegrity(bytes, plan.tarball.integrity);

  const entries = artifactCommand("tar", ["-tf", archive], packageRoot).trim().split("\n");
  const details = artifactCommand("tar", ["-tvf", archive], packageRoot).trim().split("\n");

  if (
    entries.length === 0 ||
    entries.some((entry) => !allowedPackageEntry(entry)) ||
    details.some((entry) => !/^[d-]/.test(entry))
  )
    throw new Error("Release archive contains unexpected files or links");

  const packed = JSON.parse(
    artifactCommand("tar", ["-xOf", archive, "package/package.json"], packageRoot),
  );

  if (packed.name !== metadata.name || packed.version !== metadata.version)
    throw new Error("Release archive identity differs from the checkout");

  const license = artifactCommand("tar", ["-xOf", archive, "package/LICENSE"], packageRoot);

  if (license !== (await readFile(join(workspaceRoot, "LICENSE"), "utf8")))
    throw new Error("Release license differs from the repository license");

  return {
    archive,
    name: metadata.name,
    version: metadata.version,
    entries: entries.length,
    integrity: archiveIntegrity(bytes, "sha512"),
    planIntegrity: plan.tarball.integrity,
  };
};
