import { mkdir, writeFile } from "node:fs/promises";

import { Effect, Redacted } from "effect";

import { FixtureError } from "./FixtureError.js";

export const recordFixture = (fixture: string, evidence: Readonly<Record<string, unknown>>) =>
  Effect.tryPromise({
    try: async () => {
      const directory = new URL("../../../test-results/", import.meta.url);
      await mkdir(directory, { recursive: true });
      await writeFile(
        new URL(`${fixture}.json`, directory),
        `${JSON.stringify(
          {
            ...evidence,
            observedAt: new Date().toISOString(),
            runtime: process.version,
            architecture: process.arch,
          },
          null,
          2,
        )}\n`,
      );
    },
    catch: (cause) => new FixtureError({ stage: "fixture-evidence", cause: Redacted.make(cause) }),
  });
