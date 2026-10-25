import { existsSync } from "node:fs";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { connect } from "#/node";
import { decodeRedisConfig } from "#/RedisConfig";
import { ownedServerSmoke, readOnlySmoke } from "#test/support/networking/Smoke";
import { FixtureError } from "#test/support/servers/FixtureError";
import { localServer } from "#test/support/servers/LocalServer";

it.live(
  "explicit local binary: isolated process, Unix transport, binary state and awaited cleanup",
  () =>
    Effect.gen(function* () {
      const binary = process.env.EFFECT_REDIS_TEST_BINARY;
      const engine = process.env.EFFECT_REDIS_TEST_ENGINE;
      if (binary === undefined || (engine !== "redis" && engine !== "valkey"))
        return yield* new FixtureError({ stage: "local-binary-required" });

      const completed = yield* Effect.scoped(
        Effect.gen(function* () {
          const server = yield* localServer(binary, engine);
          const connection = yield* connect(
            yield* decodeRedisConfig({ endpoint: { path: server.path } }),
          );

          yield* readOnlySmoke(connection);
          yield* ownedServerSmoke(connection);

          return server;
        }),
      );

      expect(existsSync(completed.directory)).toBe(false);
      expect(completed.pid).toBeDefined();
      const pid = completed.pid;
      if (pid !== undefined) expect(() => process.kill(pid, 0)).toThrow();

      console.info(
        JSON.stringify({ mode: "binary", engine, build: completed.build, transport: "unix" }),
      );
    }),
);
