import { existsSync } from "node:fs";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { runBun } from "#test/support/runtime/bun/Process";
import { FixtureError } from "#test/support/servers/FixtureError";
import { localServer } from "#test/support/servers/LocalServer";

it.live("Bun explicit binary: owned local process and native Unix socket", () =>
  Effect.gen(function* () {
    const binary = process.env.EFFECT_REDIS_TEST_BINARY;
    const engine = process.env.EFFECT_REDIS_TEST_ENGINE;
    if (binary === undefined || (engine !== "redis" && engine !== "valkey"))
      return yield* new FixtureError({ stage: "local-binary-required" });

    const completed = yield* Effect.scoped(
      Effect.gen(function* () {
        const server = yield* localServer(binary, engine);
        const receipt = yield* runBun({
          scenario: "smoke",
          config: { endpoint: { path: server.path } },
        });
        expect(receipt.checks).toContain("binary-echo");
        return server;
      }),
    );

    expect(existsSync(completed.directory)).toBe(false);
    if (completed.pid !== undefined) expect(() => process.kill(completed.pid ?? 0, 0)).toThrow();
  }),
);
