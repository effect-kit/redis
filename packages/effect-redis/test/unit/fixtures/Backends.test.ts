import { expect, it } from "vitest";

import {
  loadBackendManifest,
  validateBackendManifest,
} from "#test/support/fixtures/BackendManifest";

it("loads consistent pinned fixtures before preparing live resources", () => {
  const manifest = loadBackendManifest();

  expect(validateBackendManifest(manifest)).toEqual([]);
});

it.each(["valkey", "node", "ryuk"])(
  "rejects a missing %s image before fixture acquisition",
  (fixture) => {
    const manifest = loadBackendManifest();

    expect(
      validateBackendManifest({
        ...manifest,
        images: manifest.images.filter((image) => image.fixture !== fixture),
      }),
    ).toContain(`Missing fixture image: ${fixture}`);
  },
);

it("rejects an image tag that drifts from its native target", () => {
  const manifest = loadBackendManifest();
  const primary = manifest.images.find((image) => image.fixture === "redis");
  if (primary === undefined) throw new Error("Missing primary Redis fixture");

  expect(
    validateBackendManifest({
      ...manifest,
      images: [
        { ...primary, image: "redis:latest" },
        ...manifest.images.filter((image) => image.fixture !== "redis"),
      ],
    }),
  ).toContain("Image differs from native target: redis");
});

it.each(["arm64", "x64"])("requires the KeyDB image for %s hosts", (architecture) => {
  const manifest = loadBackendManifest();

  expect(
    validateBackendManifest({
      ...manifest,
      images: manifest.images.filter(
        (image) => image.fixture !== "keydb" || image.architecture !== architecture,
      ),
    }),
  ).toContain(`Missing KeyDB image architecture: ${architecture}`);
});
