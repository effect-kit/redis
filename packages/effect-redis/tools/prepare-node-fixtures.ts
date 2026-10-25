import { parseArgs } from "node:util";

import { Effect } from "effect";

import { getContainerRuntimeClient, ImageName } from "testcontainers";

import { currentImages, imageReference, selectEngine } from "#tools/FixtureTargets";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { engine: { type: "string" } },
  strict: true,
});
const selectedEngine = selectEngine(values.engine ?? process.env.EFFECT_REDIS_TEST_ENGINE);
const client = await getContainerRuntimeClient();
await Effect.runPromise(
  Effect.forEach(
    currentImages,
    (image) =>
      Effect.promise(async () => {
        if (
          selectedEngine !== "all" &&
          ![selectedEngine, "node", "ryuk"].includes(image.fixture.split("-")[0] ?? "")
        )
          return;
        const reference = imageReference(image);
        process.stdout.write(`Pulling ${reference}\n`);
        await client.image.pull(ImageName.fromString(reference));
        await client.image.inspect(ImageName.fromString(reference));
        await client.container.dockerode.getImage(reference).tag({
          repo: image.image.slice(0, image.image.lastIndexOf(":")),
          tag: image.image.slice(image.image.lastIndexOf(":") + 1),
        });
      }),
    { concurrency: 1 },
  ),
);
