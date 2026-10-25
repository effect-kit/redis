import { loadBackendManifest } from "#test/support/fixtures/BackendManifest";
import type { NodeImage } from "#test/support/fixtures/BackendSchema";

const { native, images } = loadBackendManifest();

export { images };

export const engines = [
  "redis",
  "valkey",
  "dragonfly",
  "keydb",
  "redict",
  "garnet",
  "kvrocks",
] as const;
export type Engine = (typeof engines)[number];

export const selectEngine = (value: string | undefined): Engine | "all" | "core" => {
  if (value === undefined || value === "all" || value === "core") return value ?? "all";

  const engine = engines.find((candidate) => candidate === value);
  if (engine === undefined) throw new Error("Unknown fixture engine");

  return engine;
};

export const selectedEngine = selectEngine(process.env.EFFECT_REDIS_TEST_ENGINE);
if (!["x64", "arm64"].includes(process.arch))
  throw new Error("Container fixtures require x64 or arm64");

export const currentImages = images.filter(
  (image) => image.architecture === undefined || image.architecture === process.arch,
);

export const imageReference = (image: typeof NodeImage.Type) => `${image.image}@${image.digest}`;

const requiredImage = (fixture: string) => {
  const image = currentImages.find((candidate) => candidate.fixture === fixture);
  if (image === undefined) throw new Error(`Missing fixture image: ${fixture}`);
  return image;
};

export const runtimeImage = requiredImage("node");
export const reaperImage = requiredImage("ryuk");
export const serverTargets = currentImages.flatMap((image) => {
  const fixture = native.find(
    (candidate) => candidate.id === image.fixture && candidate.kind === "engine",
  );
  if (fixture === undefined) return [];
  if (image.version !== fixture.version.replace(/^v/, "")) throw new Error("Fixture version drift");

  return [{ ...image, product: fixture.product, reference: imageReference(image) }];
});

export type ServerTarget = (typeof serverTargets)[number];
