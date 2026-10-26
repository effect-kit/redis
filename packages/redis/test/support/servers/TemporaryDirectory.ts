import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Redacted } from "effect";

import { FixtureError } from "#test/support/servers/FixtureError";

export const temporaryDirectory = Effect.acquireRelease(
  Effect.tryPromise({
    try: () => mkdtemp(join(tmpdir(), "er-")),
    catch: (cause) =>
      new FixtureError({ stage: "temporary-directory", cause: Redacted.make(cause) }),
  }),
  (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
);
