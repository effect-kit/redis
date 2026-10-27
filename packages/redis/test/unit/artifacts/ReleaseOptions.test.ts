import { expect, it } from "vitest";

import { releaseOptions } from "#test/runners/artifacts/ReleaseArchive";

it("keeps live consumers enabled for the default release commands", () => {
  const options = releaseOptions([]);

  expect(options["skip-live"]).toBe(false);
  expect(options.provenance).toBe(false);
});

it("selects fast consumers while preserving the archive path and provenance requirement", () => {
  const options = releaseOptions([
    "--skip-live",
    "--pack-dir",
    "/tmp/release-candidate",
    "--provenance",
  ]);

  expect(options["skip-live"]).toBe(true);
  expect(options["pack-dir"]).toBe("/tmp/release-candidate");
  expect(options.provenance).toBe(true);
});
