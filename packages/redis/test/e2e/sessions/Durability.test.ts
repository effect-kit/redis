import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Duration, Effect } from "effect";

import { primaryCases, atLeast } from "#test/support/commands/Backend";
import { exchange } from "#test/support/networking/Exchange";
import { recordFixture } from "#test/support/servers/Evidence";
import { replicatedBackend } from "#test/support/sessions/Replication";

it.live.each(primaryCases)(
  "SESSION-DURABILITY: $target.fixture $protocol real replication and AOF acknowledgments",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { primary, replica, replicaOracle, sessions } = yield* replicatedBackend(
        target,
        protocol,
      );
      const key = `effect-redis:durability:${randomUUID()}`;
      const value = new Uint8Array([0, 255]);

      yield* sessions.withSession((session) =>
        Effect.gen(function* () {
          const before = yield* session.raw(["CLIENT", "ID"], {
            execution: "ordinary",
            routing: { _tag: "Keyless" },
          });
          yield* session.set(key, value);
          expect(
            yield* session.waitForReplicas(1, { blockFor: Duration.seconds(3) }),
          ).toBeGreaterThanOrEqual(1n);
          expect(yield* exchange(replicaOracle, ["GET", key])).toEqual({
            _tag: "BlobString",
            value,
          });

          if (target.product === "valkey" || atLeast(target.version, "7.2.0")) {
            const fsyncs = yield* session.waitForAof(1, 1, { blockFor: Duration.seconds(3) });
            expect(fsyncs[0]).toBe(1n);
            expect(fsyncs[1]).toBeGreaterThanOrEqual(1n);
          } else
            expect(
              yield* Effect.flip(session.waitForAof(1, 1, { blockFor: Duration.millis(25) })),
            ).toMatchObject({ _tag: "ServerError" });

          expect(yield* session.waitForReplicas(2, { blockFor: Duration.millis(25) })).toBe(1n);
          expect(
            yield* session.raw(["CLIENT", "ID"], {
              execution: "ordinary",
              routing: { _tag: "Keyless" },
            }),
          ).toEqual(before);
        }),
      );
      yield* recordFixture(`session-durability-${target.fixture}-${protocol}`, {
        fixture: target.fixture,
        product: target.product,
        version: target.version,
        image: target.reference,
        protocol,
        primaryBuild: primary.build,
        replicaBuild: replica.build,
        primaryConfigurationDigest: primary.configurationDigest,
        replicaConfigurationDigest: replica.configurationDigest,
        aof: "always",
        replication: "owned-primary-replica",
        storage: "disposable-tmpfs",
      });
    }),
);
