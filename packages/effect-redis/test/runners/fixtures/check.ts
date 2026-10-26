import { loadBackendManifest } from "#test/support/fixtures/BackendManifest";
import { loadModuleManifest } from "#test/support/modules/Manifest";
import { loadProxyFixture } from "#test/support/upstash/Manifest";

const { native, images } = loadBackendManifest();
loadProxyFixture();

process.stdout.write(
  `${JSON.stringify({ nativeFixtures: native.length, images: images.length, moduleFixtures: loadModuleManifest().length, httpFixtures: 1 })}\n`,
);
