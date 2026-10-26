import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export const allowedPackageEntry = (entry: string) => {
  const path = entry.replace(/\/$/, "");
  if (path.split("/").some((part) => part === ".." || part === ".")) return false;
  return (
    [
      "package",
      "package/dist",
      "package/LICENSE",
      "package/README.md",
      "package/package.json",
    ].includes(path) ||
    /^package\/dist\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:js|d\.ts)(?:\.map)?$/.test(path)
  );
};

/** Hash emitted bytes, not timestamps; identical source must retain the exact public declarations. */
export const artifactFiles = async (directory: string): Promise<Map<string, string>> => {
  const files = new Map<string, string>();
  const visit = async (path: string): Promise<void> => {
    await Promise.all(
      (await readdir(path, { withFileTypes: true })).map(async (entry) => {
        const child = join(path, entry.name);
        if (entry.isDirectory()) await visit(child);
        else if (entry.isFile())
          files.set(
            relative(directory, child),
            createHash("sha256")
              .update(await readFile(child))
              .digest("hex"),
          );
        else throw new Error("Unexpected link in emitted artifacts");
      }),
    );
  };
  await visit(directory);
  if (files.size === 0) throw new Error("Empty emitted artifact set");
  return new Map([...files].toSorted(([left], [right]) => left.localeCompare(right)));
};

export const compareArtifacts = (
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
) => {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).toSorted();
};

/** Built JS/declarations use literal module specifiers. Inspect the reachable graph of each public boundary. */
export const portableGraph = async (directory: string, entry: string) => {
  const seen = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    if (seen.has(path)) return;
    if (!path.startsWith(resolve(directory) + sep)) throw new Error("Artifact import escaped dist");
    seen.add(path);
    const source = await readFile(path, "utf8");
    const imports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g;
    for (const match of source.matchAll(imports)) {
      const specifier = match[1];
      if (specifier === undefined) throw new Error("Malformed artifact import");
      if (/^(?:node:|bun(?:$|:)|#)/.test(specifier))
        throw new Error("Nonportable dependency in universal artifact graph");
      if (!specifier.startsWith(".")) {
        if (specifier !== "effect" && !specifier.startsWith("effect/"))
          throw new Error("Unexpected runtime dependency");
        continue;
      }
      const target = resolve(path, "..", specifier);
      // Declaration files reference JS specifiers, resolved by TypeScript to matching declarations.
      const selected = path.endsWith(".d.ts") ? target.replace(/\.js$/, ".d.ts") : target;
      // oxlint-disable-next-line no-await-in-loop -- Traverse each edge with cycle detection before following another.
      await visit(selected);
    }
  };
  await visit(resolve(directory, entry));
  return seen.size;
};
