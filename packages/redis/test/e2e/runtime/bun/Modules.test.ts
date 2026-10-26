import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { moduleBackend, moduleCases } from "#test/support/modules/Backend";
import { runtimeConfig } from "#test/support/runtime/bun/Config";
import { ModuleProfile } from "#test/support/runtime/bun/Input";
import { runBun } from "#test/support/runtime/bun/Process";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(moduleCases)(
  "BUN-MODULES: $fixture.id $protocol built runtime uses typed families and scoped cursors",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const backend = yield* moduleBackend(fixture, protocol);
      yield* backend.connection.close;
      const profile = yield* Schema.decodeUnknownEffect(ModuleProfile)(fixture.id);

      const receipt = yield* runBun({
        scenario: "modules",
        config: runtimeConfig(backend.config),
        profile,
      });

      expect(receipt.checks).toContain("binary-vector-search");
      yield* recordFixture(`bun-modules-${fixture.id}-${protocol}`, {
        ...receipt,
        observed: backend.observed,
        build: backend.server.build,
        configurationDigest: backend.server.configurationDigest,
      });
    }),
  60_000,
);
