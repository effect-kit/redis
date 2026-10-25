import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { makeRedisAdmin, makeRedisSessions, decodeRedisConfig } from "#/index";
import { connect, layer } from "#/node";
import { primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { exchange } from "#test/support/networking/Exchange";
import { allocateServer } from "#test/support/servers/DockerServer";
import { recordFixture } from "#test/support/servers/Evidence";
import { fixtureNetwork } from "#test/support/servers/Network";

it.live.each(primaryCases)(
  "ADMIN MIGRATE: $target.fixture $protocol owned destinations, auth and partial transfer",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const network = yield* fixtureNetwork;
      const password = Redacted.make("effect-disposable-migration-password");
      const source = yield* (yield* allocateServer(target, { network, networkAlias: "source" }))
        .start;
      const destination = yield* (yield* allocateServer(target, {
        network,
        networkAlias: "destination",
        password,
      })).start;
      const config = yield* decodeRedisConfig({
        endpoint: { host: "127.0.0.1", port: source.port },
        protocol,
      });
      const sessions = yield* makeRedisSessions(config).pipe(Effect.provide(layer));
      const admin = makeRedisAdmin(sessions);
      const from = yield* connect(config);
      const to = yield* connect(
        yield* decodeRedisConfig({
          endpoint: { host: "127.0.0.1", port: destination.port },
          credentials: { password: Redacted.value(password) },
        }),
      );
      yield* exchange(to, ["AUTH", Redacted.value(password)]);
      const options = {
        host: "destination",
        port: 6379,
        database: 0,
        timeoutMillis: 3000,
        auth: { username: "default", password },
      } as const;

      yield* exchange(from, ["SET", "move", new Uint8Array([0, 255])]);
      expect(yield* admin.migrate(["move"], options)).toBe("OK");
      expect(yield* exchange(to, ["GET", "move"])).toEqual({
        _tag: "BlobString",
        value: new Uint8Array([0, 255]),
      });
      expect(yield* exchange(from, ["EXISTS", "move"])).toMatchObject({ value: 0n });
      expect(yield* admin.migrate(["missing"], options)).toBe("NOKEY");

      yield* exchange(from, ["SET", "copy", "new"]);
      yield* exchange(to, ["SET", "copy", "old"]);
      expect(
        yield* admin.migrate(["copy"], {
          ...options,
          copy: true,
          replace: true,
          auth: { password },
        }),
      ).toBe("OK");
      expect(yield* exchange(from, ["GET", "copy"])).toMatchObject({ value: bytes("new") });
      expect(yield* exchange(to, ["GET", "copy"])).toMatchObject({ value: bytes("new") });

      yield* exchange(from, ["MSET", "partial-free", "a", "partial-busy", "b"]);
      yield* exchange(to, ["SET", "partial-busy", "existing"]);
      expect(
        yield* Effect.flip(admin.migrate(["partial-free", "partial-busy"], options)),
      ).toMatchObject({ _tag: "ServerError", delivery: "replied" });
      expect(yield* exchange(from, ["EXISTS", "partial-free"])).toMatchObject({ value: 0n });
      expect(yield* exchange(to, ["GET", "partial-free"])).toMatchObject({ value: bytes("a") });
      expect(yield* exchange(from, ["GET", "partial-busy"])).toMatchObject({ value: bytes("b") });
      expect(yield* exchange(to, ["GET", "partial-busy"])).toMatchObject({
        value: bytes("existing"),
      });

      expect(
        yield* Effect.flip(
          admin.migrate(["partial-busy"], {
            ...options,
            auth: { password: Redacted.make("wrong") },
          }),
        ),
      ).toMatchObject({ _tag: "ServerError" });
      expect(yield* exchange(from, ["GET", "partial-busy"])).toMatchObject({ value: bytes("b") });
      yield* recordFixture(`phase10-migrate-${target.fixture}-${protocol}`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        protocol,
        source: { build: source.build, configurationDigest: source.configurationDigest },
        destination: {
          build: destination.build,
          configurationDigest: destination.configurationDigest,
        },
        scenarios: ["MIGRATE", "AUTH2", "PARTIAL-TRANSFER"],
      });
    }),
);
