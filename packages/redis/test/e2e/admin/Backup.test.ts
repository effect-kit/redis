import { expect, it } from "@effect/vitest";
import { Effect, Redacted, Schedule } from "effect";

import { makeRedisAdmin } from "#/index";
import type { RedisAdminClient } from "#/index";
import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { recordFixture } from "#test/support/servers/Evidence";
import { FixtureError } from "#test/support/servers/FixtureError";
import { sessionBackend } from "#test/support/sessions/Backend";

const waitForSnapshot = (admin: RedisAdminClient) =>
  admin.backupStatus().pipe(
    Effect.flatMap((status) =>
      status.state === "incrementing"
        ? Effect.succeed(status)
        : Effect.fail(new FixtureError({ stage: "backup-readiness" })),
    ),
    Effect.retry({ schedule: Schedule.spaced(20), times: 200 }),
    Effect.timeout(10_000),
  );

it.live.each(primaryCases)(
  "BACKUP: $target.fixture $protocol owned snapshot/abort/seal/cleanup lifecycle",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const supported = target.product === "redis" && atLeast(target.version, "8.10.0");
      const { sessions, redis, server, prefix } = yield* sessionBackend(
        target,
        protocol,
        supported ? ["backupdirname backup-phase10"] : undefined,
      );
      const admin = makeRedisAdmin(sessions);
      if (!supported) {
        expect(yield* Effect.flip(admin.backupStatus())).toMatchObject({ _tag: "ServerError" });
        return;
      }

      expect((yield* admin.backupStatus()).state).toBe("idle");
      expect(yield* admin.backupHelp()).not.toHaveLength(0);
      yield* redis.set(`${prefix}:backup`, "before");
      yield* admin.backupStart();
      yield* waitForSnapshot(admin);
      yield* admin.backupAbort();
      expect((yield* admin.backupStatus()).state).toBe("failed");
      yield* admin.backupCleanup();
      yield* admin.backupStart();
      const started = yield* waitForSnapshot(admin);
      expect(started.startTimeSeconds).toBeGreaterThan(0n);
      yield* redis.set(`${prefix}:backup`, "during");
      yield* admin.backupSeal();
      const sealed = yield* admin.backupStatus();
      expect(sealed.state).toBe("sealed");
      expect(sealed.endTimeSeconds).toBeGreaterThanOrEqual(sealed.startTimeSeconds);
      expect(Redacted.value(yield* admin.backupList())).toHaveLength(3);
      yield* admin.backupCleanup();
      expect((yield* admin.backupStatus()).state).toBe("idle");
      expect(Redacted.value(yield* admin.backupList())).toEqual([]);

      yield* recordFixture(`phase10-backup-${target.fixture}-${protocol}`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        protocol,
        build: server.build,
        configurationDigest: server.configurationDigest,
        scenarios: ["BACKUP", "OWNED-TMPFS", "ABORT-SEAL-CLEANUP"],
      });
    }),
);
