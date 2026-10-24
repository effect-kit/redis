import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { Schema } from "effect";

import { NodeImage } from "./spec/Schema.ts";

const images = Schema.decodeUnknownSync(Schema.NonEmptyArray(NodeImage))(
  JSON.parse(
    readFileSync(new URL("../../../spec/fixtures/node-images.json", import.meta.url), "utf8"),
  ),
);
for (const { image, digest } of images) {
  const reference = `${image}@${digest}`;
  process.stdout.write(`Pulling ${reference}\n`);
  const result = spawnSync("docker", ["pull", reference], { stdio: "inherit", timeout: 180_000 });
  if (result.error || result.status !== 0) {
    process.stderr.write(`Fixture pull failed: ${String(result.error ?? result.status)}\n`);
    process.exitCode = 1;
    break;
  }
  const tag = spawnSync("docker", ["image", "tag", reference, image], {
    stdio: "inherit",
    timeout: 30_000,
  });
  if (tag.error || tag.status !== 0) {
    process.stderr.write(`Fixture tagging failed: ${String(tag.error ?? tag.status)}\n`);
    process.exitCode = 1;
    break;
  }
}
