import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { packageRoot, workspaceRoot } from "#test/support/providers/Configuration";

/** Include executable scenarios and built code: a source edit during a run invalidates its aggregate. */
export const providerArtifactDigest = async () => {
  const roots = [
    "dist",
    "test/.cache/providers/bundle",
    "test/runners/providers",
    "test/support/providers",
    "test/fixtures/runtime",
    "test/e2e/providers",
  ];
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile()) files.push(path);
      }),
    );
  };
  await Promise.all(roots.map((root) => visit(join(packageRoot, root))));
  const hash = createHash("sha256");
  for (const path of files.toSorted()) {
    // oxlint-disable-next-line no-await-in-loop -- Hash in deterministic order without opening every artifact at once.
    const bytes = await readFile(path);
    hash.update(relative(packageRoot, path)).update(bytes);
  }
  return hash.digest("hex");
};

export const providerRuntimeVersions = async () => {
  const [node, bun, deno, workers] = await Promise.all([
    readFile(join(workspaceRoot, ".node-version"), "utf8"),
    readFile(join(workspaceRoot, ".bun-version"), "utf8"),
    readFile(join(workspaceRoot, ".deno-version"), "utf8"),
    readFile(join(packageRoot, "test/fixtures/runtime/workers.json"), "utf8"),
  ]);
  const policy: { compatibilityDate: string } = JSON.parse(workers);
  return {
    node: node.trim(),
    bun: bun.trim(),
    deno: deno.trim(),
    workers: `compatibility-${policy.compatibilityDate}`,
  };
};
