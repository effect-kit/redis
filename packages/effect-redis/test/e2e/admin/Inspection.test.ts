import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { Commands, makeRedisAdmin } from "#/index";
import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { recordFixture } from "#test/support/servers/Evidence";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "ADMIN: $target.fixture $protocol explicit inspection, secrets and version gaps",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { sessions, redis, prefix, server } = yield* sessionBackend(target, protocol);
      const admin = makeRedisAdmin(sessions);
      const key = `${prefix}:memory`;
      yield* redis.set(key, "value");

      const info = yield* admin.info(["all"]);
      expect(info.sections.length).toBeGreaterThan(2);
      expect(info.raw).toContain("used_memory:");
      expect(yield* admin.dbsize()).toBe(1n);
      expect((yield* admin.time())[0]).toBeGreaterThan(0n);
      expect(yield* admin.lastSave()).toBeGreaterThan(0n);
      expect(yield* admin.role()).not.toHaveLength(0);
      expect(yield* admin.commandCount()).toBeGreaterThan(100n);
      expect(yield* admin.command()).not.toHaveLength(0);
      expect(yield* admin.commandInfo(["GET", "effect_nonexistent"])).toHaveLength(2);
      expect(yield* admin.commandGetKeys(["MGET", key, `${key}:2`])).toEqual([
        bytes(key),
        bytes(`${key}:2`),
      ]);
      expect(yield* admin.commandHelp()).not.toHaveLength(0);
      if (atLeast(target.version, "7.0.0")) {
        expect(yield* admin.commandDocs(["GET"])).not.toHaveLength(0);
        expect(yield* admin.commandList({ by: "PATTERN", value: "get" })).toContain("get");
        expect((yield* admin.commandGetKeysAndFlags(["GET", key]))[0]?.[0]).toEqual(bytes(key));
      } else {
        expect(yield* Effect.flip(admin.commandDocs(["GET"]))).toMatchObject({
          _tag: "ServerError",
        });
      }

      expect(Option.getOrThrow(yield* admin.memoryUsage(key, 0))).toBeGreaterThan(0n);
      expect(yield* admin.memoryUsage(`${key}:missing`)).toEqual(Option.none());
      expect(yield* admin.memoryStats()).not.toHaveLength(0);
      expect(yield* admin.memoryDoctor()).not.toHaveLength(0);
      expect(yield* admin.memoryMallocStats()).not.toHaveLength(0);
      yield* admin.memoryPurge();
      expect(yield* admin.memoryHelp()).not.toHaveLength(0);
      expect(yield* admin.moduleList()).toBeInstanceOf(Array);
      expect(yield* admin.moduleHelp()).not.toHaveLength(0);
      expect(yield* Effect.flip(admin.moduleLoad("/effect-missing-module"))).toMatchObject({
        _tag: "ServerError",
      });
      expect(yield* Effect.flip(admin.moduleUnload("effect_missing_module"))).toMatchObject({
        _tag: "ServerError",
      });
      if (atLeast(target.version, "7.0.0"))
        expect(
          yield* Effect.flip(admin.moduleLoadEx("/effect-missing-module", { args: ["arg"] })),
        ).toMatchObject({ _tag: "ServerError" });

      expect(yield* admin.aclWhoAmI()).toBe("default");
      expect(yield* admin.aclUsers()).toContain("default");
      expect(yield* admin.aclCat()).toContain("read");
      expect(yield* admin.aclCat("read")).toContain("get");
      expect(yield* admin.aclHelp()).not.toHaveLength(0);
      expect(Redacted.value(yield* admin.aclGenPass(128))).toMatch(/^[a-f0-9]{32}$/);
      expect(Redacted.value(yield* admin.aclGetUser("default"))).toMatchObject({ _tag: "Some" });
      expect(Redacted.value(yield* admin.aclList())).not.toHaveLength(0);
      // This docs-only 9.2 operation is deliberately not claimed against our pinned 9.1 server.
      expect(yield* Effect.flip(admin.aclDigest())).toMatchObject({ _tag: "ServerError" });
      if (atLeast(target.version, "7.0.0"))
        expect(yield* admin.aclDryRun("default", ["GET", key])).toBe("OK");
      expect(Redacted.value(yield* admin.configGet(["maxmemory"]))).toHaveLength(1);
      expect(yield* admin.configHelp()).not.toHaveLength(0);
      expect(yield* admin.echo(new Uint8Array([0, 255]))).toEqual(new Uint8Array([0, 255]));
      expect(yield* redis.echo(new Uint8Array([0, 255]))).toEqual(new Uint8Array([0, 255]));
      expect(yield* redis.pingMessage("")).toEqual(new Uint8Array());

      yield* sessions.withSession((session) =>
        Effect.gen(function* () {
          yield* session.execute(Commands.clientSetName("phase10"));
          expect(yield* session.execute(Commands.clientGetName())).toEqual(Option.some("phase10"));
          expect(yield* session.execute(Commands.clientId())).toBeGreaterThan(0n);
          expect(yield* session.execute(Commands.clientGetRedir())).toBe(-1n);
          expect(Redacted.value(yield* session.execute(Commands.clientInfo()))).toContain(
            "name=phase10",
          );
          expect(
            Redacted.value(yield* session.execute(Commands.clientList({ type: "normal" }))),
          ).toContain("name=phase10");
          if (atLeast(target.version, "7.0.0"))
            yield* session.execute(Commands.clientNoEvict(true));
          if (atLeast(target.version, "7.2.0")) {
            yield* session.execute(Commands.clientNoTouch(false));
            yield* session.execute(Commands.clientSetInfo("lib-name", "effect-redis"));
          }
        }),
      );
      expect(yield* admin.clientHelp()).not.toHaveLength(0);
      expect(yield* admin.clientUnblock(9223372036854775807n, "TIMEOUT")).toBe(false);
      expect(yield* admin.clientKill({ id: 9223372036854775807n, skipMe: true })).toBe(0n);
      yield* admin.clientPause(1, "WRITE");
      yield* admin.clientUnpause();
      yield* recordFixture(`phase10-admin-inspection-${target.fixture}-${protocol}`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        protocol,
        build: server.build,
        configurationDigest: server.configurationDigest,
        scenarios: ["ADMIN-INSPECTION"],
      });
    }),
);
