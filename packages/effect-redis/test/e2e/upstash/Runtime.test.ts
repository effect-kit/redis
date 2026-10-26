import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { recordFixture } from "#test/support/servers/Evidence";
import { httpTargets, upstashFixture } from "#test/support/upstash/Fixture";
import { httpRuntimes, runHttpRuntime } from "#test/support/upstash/Process";

const cases = httpTargets.flatMap((target) => httpRuntimes.map((runtime) => ({ target, runtime })));
it.live.each(cases)(
  "HTTP-RUNTIME: $runtime/$target.fixture built exports use actual fetch and SSE",
  ({ runtime, target }) =>
    Effect.gen(function* () {
      const fixture = yield* upstashFixture(target);
      const receipt = yield* runHttpRuntime(runtime, {
        url: fixture.input.url,
        token: Redacted.value(fixture.input.token),
        prefix: `http-runtime:${randomUUID()}`,
      });

      expect(receipt.checks).toContain("SSE");
      yield* recordFixture(`http-runtime-${runtime}-${target.fixture}`, {
        ...receipt,
        proxy: fixture.proxy,
        build: fixture.build,
        configurationDigest: fixture.configurationDigest,
      });
    }),
);
