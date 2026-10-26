import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { runBun } from "#test/support/runtime/bun/Process";
import { bunCases } from "#test/support/runtime/bun/Targets";
import { allocateServer } from "#test/support/servers/DockerServer";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(bunCases)(
  "BUN-CLIENT: $target.fixture $protocol typed data, sessions, events and authentication",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const password = randomUUID();
      const server = yield* (yield* allocateServer(target, { password: Redacted.make(password) }))
        .start;
      const config = {
        endpoint: { host: "127.0.0.1", port: server.port },
        protocol,
        credentials: { password },
      };

      for (const scenario of ["client", "sessions", "events", "auth-error"] as const) {
        const receipt = yield* runBun({
          scenario,
          config:
            scenario === "auth-error" ? { ...config, credentials: { password: "wrong" } } : config,
        });
        expect(receipt.bun).toBe("1.4.4");
        yield* recordFixture(`bun-${target.fixture}-${protocol}-${scenario}`, {
          ...receipt,
          build: server.build,
          configurationDigest: server.configurationDigest,
        });
      }
    }),
  90_000,
);
