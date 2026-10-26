import { readFileSync } from "node:fs";

import { Schema } from "effect";

import { NativeFixture, NodeImage } from "#test/support/fixtures/BackendSchema";

export interface BackendManifest {
  readonly native: ReadonlyArray<typeof NativeFixture.Type>;
  readonly images: ReadonlyArray<typeof NodeImage.Type>;
}

/** Check fixture relationships before any image download or container acquisition. */
export const validateBackendManifest = ({
  native,
  images,
}: BackendManifest): ReadonlyArray<string> => {
  const issues: Array<string> = [];
  const unique = (label: string, names: ReadonlyArray<string>) => {
    if (new Set(names).size !== names.length) issues.push(`Duplicate ${label}`);
  };

  unique(
    "native fixture IDs",
    native.map((fixture) => fixture.id),
  );
  unique(
    "image fixtures",
    images.map((image) => `${image.fixture}:${image.architecture ?? "multi"}`),
  );

  for (const fixture of native) {
    if (!images.some((image) => image.fixture === fixture.id))
      issues.push(`Missing fixture image: ${fixture.id}`);
  }

  for (const image of images) {
    const fixture = native.find((target) => target.id === image.fixture);
    const version =
      fixture?.version.replace(/^v/, "") ?? (image.fixture === "ryuk" ? image.version : undefined);
    const suffix =
      image.fixture === "keydb"
        ? `:${image.architecture === "arm64" ? "arm64" : "x86_64"}_v${version}`
        : `:${image.fixture === "dragonfly" ? "v" : ""}${version}${image.variant === undefined ? "" : `-${image.variant}`}`;

    if (version === undefined || image.version !== version || !image.image.endsWith(suffix))
      issues.push(`Image differs from native target: ${image.fixture}`);

    if (
      fixture?.kind === "engine" &&
      image.moduleList !== "unsupported" &&
      image.modules === undefined
    )
      issues.push(`Missing fixture module inventory: ${image.fixture}`);
  }

  for (const architecture of ["arm64", "x64"]) {
    if (!images.some((image) => image.fixture === "keydb" && image.architecture === architecture))
      issues.push(`Missing KeyDB image architecture: ${architecture}`);
  }

  for (const fixture of ["node", "bun", "ryuk"]) {
    if (!images.some((image) => image.fixture === fixture))
      issues.push(`Missing fixture image: ${fixture}`);
  }

  return issues;
};

export const loadBackendManifest = (): BackendManifest => {
  const native = Schema.decodeUnknownSync(Schema.NonEmptyArray(NativeFixture), {
    onExcessProperty: "error",
  })(
    JSON.parse(
      readFileSync(new URL("../../fixtures/backends/engines.json", import.meta.url), "utf8"),
    ),
  );
  const images = Schema.decodeUnknownSync(Schema.NonEmptyArray(NodeImage), {
    onExcessProperty: "error",
  })(
    JSON.parse(
      readFileSync(new URL("../../fixtures/backends/images.json", import.meta.url), "utf8"),
    ),
  );

  const manifest = { native, images };
  const issues = [...validateBackendManifest(manifest)];
  const bunVersion = readFileSync(
    new URL("../../../../../.bun-version", import.meta.url),
    "utf8",
  ).trim();
  if (native.find((fixture) => fixture.id === "bun")?.version !== bunVersion)
    issues.push("Bun fixture differs from .bun-version");
  if (issues.length !== 0) throw new Error(issues.join("\n"));

  return manifest;
};
