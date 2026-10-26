import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { artifactCommand } from "#test/runners/artifacts/Command";
import { checkConsumers } from "#test/runners/artifacts/Consumers";
import {
  allowedPackageEntry,
  artifactFiles,
  compareArtifacts,
  portableGraph,
} from "#test/support/artifacts/Policy";

const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const output = join(packageRoot, "test/results/artifacts", randomUUID());
const scratch = await mkdtemp(join(tmpdir(), "effect-kit-artifacts-"));
try {
  await mkdir(output, { recursive: true });
  const builds: ReadonlyMap<string, string>[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    artifactCommand("pnpm", ["run", "build"], packageRoot);
    // oxlint-disable-next-line no-await-in-loop -- Each clean build must settle before inspecting or rebuilding dist.
    const files = await artifactFiles(join(packageRoot, "dist"));
    const first = builds[0];
    if (first !== undefined) {
      const differences = compareArtifacts(first, files);
      if (differences.length !== 0)
        throw new Error(`Identical-source artifact drift: ${differences.join(", ")}`);
    }
    builds.push(files);
    process.stdout.write(
      `Identical-source build ${attempt + 1}/3 verified (${files.size} files).\n`,
    );
  }
  const portable = Object.fromEntries(
    await Promise.all(
      ["index.js", "index.d.ts", "upstash.js", "upstash.d.ts"].map(async (entry) => [
        entry,
        await portableGraph(join(packageRoot, "dist"), entry),
      ]),
    ),
  );
  artifactCommand("pnpm", ["pack", "--ignore-scripts", "--pack-destination", output], packageRoot);
  const metadata: { name: string; version: string } = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  const archiveName = `${metadata.name.replace(/^@/, "").replace("/", "-")}-${metadata.version}.tgz`;
  const archive = join(output, archiveName);
  const entries = artifactCommand("tar", ["-tf", archive], packageRoot).trim().split("\n");
  if (entries.length === 0 || entries.some((entry) => !allowedPackageEntry(entry)))
    throw new Error("Package contains unexpected or private files");
  const consumers = await checkConsumers(archive, scratch, packageRoot, workspaceRoot);
  const first = builds[0];
  if (first === undefined) throw new Error("Missing build evidence");
  const manifest = {
    observedAt: new Date().toISOString(),
    commit: artifactCommand("git", ["rev-parse", "HEAD"], workspaceRoot).trim(),
    workingTreeClean:
      artifactCommand("git", ["status", "--porcelain"], workspaceRoot).trim() === "",
    builds: builds.length,
    files: Object.fromEntries(first),
    portable,
    consumers,
    archive: {
      name: archiveName,
      entries: entries.length,
      sha256: createHash("sha256")
        .update(await readFile(archive))
        .digest("hex"),
    },
  };
  await writeFile(join(output, "verification.json"), JSON.stringify(manifest, null, 2));
  process.stdout.write(`Artifact verification passed: ${output}/verification.json\n`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
