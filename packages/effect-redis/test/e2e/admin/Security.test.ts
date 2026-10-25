import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { Commands, decodeRedisConfig, makeRedisAdmin, makeRedisSessions } from "#/index";
import { layer } from "#/node";
import { primaryCases } from "#test/support/commands/Backend";
import { allocateServer } from "#test/support/servers/DockerServer";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(primaryCases)(
  "ADMIN ACL: $target.fixture $protocol persisted rules, denial and lease identity",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const server = yield* (yield* allocateServer(target, {
        writableConfiguration: true,
        aclRules: "user default on nopass ~* &* +@all\n",
      })).start;
      const config = yield* decodeRedisConfig({
        endpoint: { host: "127.0.0.1", port: server.port },
        protocol,
      });
      const sessions = yield* makeRedisSessions(config).pipe(Effect.provide(layer));
      const admin = makeRedisAdmin(sessions);

      yield* admin.configSet(Redacted.make([["timeout", "300"]]));
      yield* admin.configRewrite();
      yield* admin.aclSetUser(
        "limited",
        Redacted.make(["on", ">disposable-password", "~*", "+get", "+ping", "+select", "+hello"]),
      );
      yield* admin.aclSave();
      expect(yield* admin.aclDelUser(["limited"])).toBe(1n);
      yield* admin.aclLoad();
      expect(yield* admin.aclUsers()).toContain("limited");

      yield* sessions.withSession((session) =>
        Effect.gen(function* () {
          expect(yield* session.hello()).not.toHaveLength(0);
          yield* session.selectDatabase(2);
          yield* session.set("phase10-db", "isolated");
        }),
      );
      yield* sessions.withSession((session) =>
        Effect.gen(function* () {
          expect(yield* session.get("phase10-db")).toEqual(Option.none());
          yield* session.authenticate({
            username: Redacted.make("limited"),
            password: Redacted.make("disposable-password"),
          });
          yield* session.ping();
          expect(
            yield* Effect.flip(session.execute(Commands.configGet(["maxmemory"]))),
          ).toMatchObject({ _tag: "ServerError", code: "NOPERM" });
        }),
      );
      expect(yield* admin.aclWhoAmI()).toBe("default");
      expect(yield* admin.aclDelUser(["limited"])).toBe(1n);
      yield* recordFixture(`phase10-admin-acl-persistence-${target.fixture}-${protocol}`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        protocol,
        build: server.build,
        configurationDigest: server.configurationDigest,
        scenarios: ["ADMIN-ACL-PERSISTENCE"],
      });
    }),
);
