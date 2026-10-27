import { expect, it } from "vitest";

import {
  archiveIntegrity,
  releasePlan,
  verifyReleaseIntegrity,
} from "#test/support/artifacts/ReleasePlan";

const bytes = new TextEncoder().encode("packed candidate");
const release = {
  kind: "publish",
  name: "@effect-kit/redis",
  version: "0.1.0",
  access: "public",
  tag: "latest",
  tarball: {
    path: "packages/effect-kit-redis-0.1.0.tgz",
    integrity: archiveIntegrity(bytes, "sha256"),
  },
};
const plan = (entry: unknown = release) => ({ version: 1, plan: [[entry]] });

it("binds the Changesets plan to the exact public candidate and archive bytes", () => {
  expect(releasePlan(plan(), "0.1.0")).toEqual(release);
  expect(() => verifyReleaseIntegrity(bytes, release.tarball.integrity)).not.toThrow();

  expect(() => verifyReleaseIntegrity(new Uint8Array([0]), release.tarball.integrity)).toThrow(
    "differs",
  );
});

it.each([
  { ...release, name: "@effect-kit/other" },
  { ...release, version: "0.2.0" },
  { ...release, kind: "tag-only" },
  { ...release, access: "restricted" },
  { ...release, tag: "unexpected" },
  { ...release, tarball: { ...release.tarball, path: "../candidate.tgz" } },
  { ...release, tarball: { ...release.tarball, integrity: "sha256-bad" } },
])("rejects a changed publication contract: %j", (entry) => {
  expect(() => releasePlan(plan(entry), "0.1.0")).toThrow();
});

it("rejects missing, duplicate and unreviewed plan versions", () => {
  expect(() => releasePlan({ version: 1, plan: [] }, "0.1.0")).toThrow();
  expect(() => releasePlan({ version: 1, plan: [[release, release]] }, "0.1.0")).toThrow();
  expect(() => releasePlan({ version: 2, plan: [[release]] }, "0.1.0")).toThrow();
});
