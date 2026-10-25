import { loadBackendManifest } from "#test/support/fixtures/BackendManifest";

const { native, images } = loadBackendManifest();

process.stdout.write(
  `${JSON.stringify({ nativeFixtures: native.length, images: images.length })}\n`,
);
