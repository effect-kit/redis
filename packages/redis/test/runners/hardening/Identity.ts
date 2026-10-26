import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus, release, totalmem } from "node:os";
import { join } from "node:path";

import { getContainerRuntimeClient } from "testcontainers";

import { artifactFiles } from "#test/support/artifacts/Policy";

export const hardeningIdentity = async (packageRoot: string) => {
  const [node, bun] = await Promise.all(
    [".node-version", ".bun-version"].map((name) =>
      readFile(join(packageRoot, "../..", name), "utf8"),
    ),
  );
  const child = spawnSync("bun", ["--version"], { encoding: "utf8", timeout: 5000 });
  if (
    process.versions.node !== node?.trim() ||
    child.error ||
    child.status !== 0 ||
    child.stdout.trim() !== bun?.trim()
  )
    throw new Error("Hardening requires the pinned Node and Bun versions");
  const client = await getContainerRuntimeClient();
  const [version, info] = await Promise.all([
    client.container.dockerode.version(),
    client.container.dockerode.info(),
  ]);
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: packageRoot, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  if (commit.error || status.error || commit.status !== 0 || status.status !== 0)
    throw new Error("Missing source identity");
  return {
    commit: commit.stdout.trim(),
    workingTreeClean: status.stdout.trim() === "",
    host: {
      platform: process.platform,
      architecture: process.arch,
      kernel: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
    },
    runtimes: { node: process.versions.node, bun: child.stdout.trim() },
    docker: {
      version: version.Version,
      api: version.ApiVersion,
      kernel: version.KernelVersion,
      architecture: info.Architecture,
      os: info.OperatingSystem,
      cpus: info.NCPU,
      memoryBytes: info.MemTotal,
    },
  };
};

/** Bind evidence to executable infrastructure as well as dist; editing a harness mid-run invalidates it. */
export const hardeningDigest = async (packageRoot: string) => {
  const roots = [
    "dist",
    "test/runners/hardening",
    "test/support",
    "test/fixtures/hardening",
    "test/fixtures/backends",
    "test/fixtures/upstash",
  ];
  const snapshots = await Promise.all(roots.map((root) => artifactFiles(join(packageRoot, root))));
  const hash = createHash("sha256");
  for (const [index, files] of snapshots.entries())
    for (const [path, digest] of files) hash.update(`${roots[index]}/${path}\0${digest}\n`);
  return hash.digest("hex");
};
