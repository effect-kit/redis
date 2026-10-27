import { expect, it } from "vitest";

import { allowedPackageEntry, compareArtifacts } from "#test/support/artifacts/Policy";

it("rejects private files and traversal paths in a package archive", () => {
  for (const path of [
    "package/.env",
    "package/research/notes.md",
    "package/test/fixture.pem",
    "/package/dist/index.js",
    "package/dist/../secret",
    "package/dist/./index.js",
    "package/dist/.env",
    "package/dist/key.pem",
  ])
    expect(allowedPackageEntry(path)).toBe(false);
  for (const path of [
    "package/",
    "package/dist/",
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/LICENSE",
    "package/CHANGELOG.md",
    "package/package.json",
  ])
    expect(allowedPackageEntry(path)).toBe(true);
});

it("detects removed, added and byte-different files without ignoring declaration drift", () => {
  const before = new Map([
    ["index.js", "same"],
    ["streams.d.ts", "old"],
    ["removed.d.ts", "old"],
  ]);
  const after = new Map([
    ["index.js", "same"],
    ["streams.d.ts", "new"],
    ["added.d.ts", "new"],
  ]);
  expect(compareArtifacts(before, after)).toEqual(["added.d.ts", "removed.d.ts", "streams.d.ts"]);
  expect(compareArtifacts(before, before)).toEqual([]);
});
