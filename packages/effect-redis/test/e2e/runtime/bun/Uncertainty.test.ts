import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { backend } from "#test/support/commands/Backend";
import { runBun } from "#test/support/runtime/bun/Process";
import { bunCases } from "#test/support/runtime/bun/Targets";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(bunCases)(
  "BUN-UNKNOWN: $target.fixture $protocol lost mutations, EXEC and group delivery never replay",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const fixture = yield* backend(target, protocol);

      for (const operation of ["mutation", "exec", "group"] as const) {
        const key = `bun:unknown:${operation}:${randomUUID()}`;
        const receipt = yield* runBun({
          scenario: "uncertainty",
          operation,
          key,
          config: { endpoint: { host: "127.0.0.1", port: fixture.server.port }, protocol },
        });

        if (operation === "group") {
          expect((yield* fixture.redis.xpending(key, "workers")).count).toBe(1n);
          expect(
            (yield* fixture.redis.xpendingEntries(key, "workers", {
              start: "-",
              end: "+",
              count: 1,
            }))[0]?.deliveries,
          ).toBe(1n);
        } else {
          expect(yield* fixture.redis.get(key)).toEqual(Option.some("1"));
        }
        yield* recordFixture(`bun-unknown-${target.fixture}-${protocol}-${operation}`, {
          ...receipt,
          build: fixture.server.build,
          configurationDigest: fixture.server.configurationDigest,
        });
      }
    }),
  60_000,
);
