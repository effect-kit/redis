import { expect, it } from "@effect/vitest";
import { Effect, Schedule } from "effect";

import { checkServerReply } from "#/command/Decode";
import { reportText } from "#/commands/admin/Build";
import { bloomAofPayload } from "#test/support/modules/Aof";
import { moduleBackend, moduleCases } from "#test/support/modules/Backend";
import { recordFixture } from "#test/support/servers/Evidence";
import { FixtureError } from "#test/support/servers/FixtureError";

it.live.each(moduleCases)(
  "MODULE-VALKEY-BLOOM: $fixture.id $protocol load serialization and scaling extensions",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix, connection, server, observed } = yield* moduleBackend(
        fixture,
        protocol,
        { aof: fixture.engine === "valkey" },
      );
      const key = `${prefix}:filter`;
      if (fixture.engine !== "valkey") {
        expect(yield* Effect.flip(redis.bfLoad(key, new Uint8Array([1])))).toMatchObject({
          _tag: "ServerError",
        });
        expect(
          yield* Effect.flip(redis.bfInsert(key, ["a"], { validateScaleTo: 1000 })),
        ).toMatchObject({ _tag: "ServerError" });
      } else {
        yield* redis.bfReserve(key, 0.001, 100, { expansion: 2 });
        expect(yield* redis.bfInfoErrorRate(key)).toBeCloseTo(0.001);
        expect(yield* redis.bfInfoTightening(key)).toBeGreaterThan(0);
        expect(yield* redis.bfInfoMaxScaledCapacity(key)).toBeGreaterThanOrEqual(1000n);
        expect(yield* redis.bfInsert(key, ["a"], { validateScaleTo: 1000 })).toEqual([true]);
        expect(
          yield* Effect.flip(redis.bfLoad(`${prefix}:bad`, new Uint8Array([1]))),
        ).toMatchObject({ _tag: "ServerError" });
        yield* connection.executeOrdinary(["BGREWRITEAOF"]).pipe(Effect.flatMap(checkServerReply));
        yield* connection.executeOrdinary(["INFO", "persistence"]).pipe(
          Effect.flatMap(checkServerReply),
          Effect.flatMap(reportText),
          Effect.flatMap((info) =>
            info.includes("aof_rewrite_in_progress:0")
              ? Effect.void
              : Effect.fail(new FixtureError({ stage: "module-aof-not-ready" })),
          ),
          Effect.retry({ times: 200, schedule: Schedule.spaced(10) }),
        );
        const payload = yield* bloomAofPayload(server.directory);
        yield* redis.bfLoad(`${prefix}:restored`, payload);
        expect(yield* redis.bfExists(`${prefix}:restored`, "a")).toBe(true);
        expect(yield* Effect.flip(redis.bfLoad(`${prefix}:restored`, payload))).toMatchObject({
          _tag: "ServerError",
        });
      }
      yield* recordFixture(`module-valkey-bloom-${fixture.id}-${protocol}`, {
        protocol,
        observed,
        build: server.build,
        configurationDigest: server.configurationDigest,
        checks: [
          "actual-aof-serialization",
          "opaque-load",
          "invalid-and-existing-load",
          "scale-validation",
          "info-extensions",
        ],
      });
    }),
  90_000,
);
