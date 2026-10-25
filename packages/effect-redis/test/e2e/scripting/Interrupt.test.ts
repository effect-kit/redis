import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Schedule } from "effect";

import { Reply } from "#/index";
import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { recordFixture } from "#test/support/servers/Evidence";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "SCRIPT KILL: $target.fixture $protocol interrupts actual read-only work on another client",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { sessions, redis, server } = yield* sessionBackend(target, protocol, [
        "lua-time-limit 20",
      ]);
      yield* redis.ping();
      const evaluation = yield* Effect.forkChild(
        Effect.flip(redis.evalScript("while true do end", { keys: [] }, Reply.integer)),
      );

      yield* sessions
        .withSession((session) => session.scriptKill())
        .pipe(
          Effect.retry({
            while: (error) => error._tag === "ServerError" && error.code === "NOTBUSY",
            schedule: Schedule.spaced(10),
            times: 100,
          }),
        );
      expect(yield* Fiber.join(evaluation)).toMatchObject({ _tag: "ServerError", code: "ERR" });
      yield* redis.ping();

      if (atLeast(target.version, "7.0.0")) {
        yield* redis.functionLoad(
          "#!lua name=effect_kill\nredis.register_function('effect_forever', function(keys,args) while true do end end)",
        );
        const invocation = yield* Effect.forkChild(
          Effect.flip(redis.fcall("effect_forever", { keys: [] }, Reply.integer)),
        );
        yield* sessions
          .withSession((session) => session.functionKill())
          .pipe(
            Effect.retry({
              while: (error) => error._tag === "ServerError" && error.code === "NOTBUSY",
              schedule: Schedule.spaced(10),
              times: 100,
            }),
          );
        expect(yield* Fiber.join(invocation)).toMatchObject({ _tag: "ServerError", code: "ERR" });
        yield* redis.ping();
      } else
        expect(yield* Effect.flip(redis.functionKill())).toMatchObject({ _tag: "ServerError" });

      yield* recordFixture(`phase10-script-kill-${target.fixture}-${protocol}`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        protocol,
        build: server.build,
        configurationDigest: server.configurationDigest,
        scenarios: ["SCRIPT-KILL", "FUNCTION-KILL", "SEPARATE-CLIENT"],
      });
    }),
);
