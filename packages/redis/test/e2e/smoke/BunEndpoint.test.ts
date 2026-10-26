import { readFile } from "node:fs/promises";

import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { runBun } from "#test/support/runtime/bun/Process";
import { FixtureError } from "#test/support/servers/FixtureError";

it.live("Bun explicit endpoint: connection-only AUTH and read-only binary PING/ECHO", () =>
  Effect.gen(function* () {
    const url = process.env.EFFECT_REDIS_TEST_URL;
    if (url === undefined) return yield* new FixtureError({ stage: "endpoint-url-required" });
    const caPath = process.env.EFFECT_REDIS_TEST_CA;
    const ca =
      caPath === undefined
        ? undefined
        : yield* Effect.tryPromise({
            try: () => readFile(caPath, "utf8"),
            catch: (cause) =>
              new FixtureError({ stage: "endpoint-ca", cause: Redacted.make(cause) }),
          });

    const receipt = yield* runBun({
      scenario: "smoke",
      config: { endpoint: { url, ...(ca === undefined ? {} : { tls: { ca } }) } },
    });

    expect(receipt.checks).toEqual(["connection-only-auth", "read-only-ping", "binary-echo"]);
  }),
);
