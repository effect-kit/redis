import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeRedisShutdown } from "#/index";
import { layer } from "#/node";
import { primaryCases } from "#test/support/commands/Backend";
import { recordFixture } from "#test/support/servers/Evidence";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "SHUTDOWN: $target.fixture $protocol owned shutdown observes EOF without an execution claim",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { config, server, redis } = yield* sessionBackend(target, protocol);
      const control = yield* makeRedisShutdown(config).pipe(Effect.provide(layer));
      expect(yield* Effect.flip(control.abort())).toMatchObject({ _tag: "ServerError" });
      yield* redis.ping();

      expect(yield* control.shutdown({ save: "NOSAVE" })).toEqual({
        _tag: "ConnectionClosed",
        execution: "unknown",
      });
      yield* recordFixture(`phase10-shutdown-${target.fixture}-${protocol}`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        protocol,
        build: server.build,
        configurationDigest: server.configurationDigest,
        scenarios: ["SHUTDOWN", "OWNED-SERVER", "EOF-UNKNOWN"],
      });
    }),
);
