import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Redacted } from "effect";

import { makeExecutor } from "#/command/Executor";
import { Commands, makeRedisAdmin } from "#/index";
import { controlled, sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect("ADMIN: ordinary executors reject administrative mode before any write", () =>
  Effect.gen(function* () {
    const { connection, fixture } = yield* controlled();
    expect(
      yield* Effect.flip(makeExecutor(connection).execute(Commands.configGet(["*"]))),
    ).toMatchObject({
      _tag: "UnsupportedCommandError",
      reason: "execution-mode",
      delivery: "unsent",
    });
    expect(yield* fixture.written).toEqual([]);
  }),
);

it.effect.each([
  "NOPERM denied",
  "ERR unknown command",
  "ERR wrong number of arguments",
  "FUTURE_CODE private detail",
])("ADMIN: %s remains a redacted server rejection without retry or emulation", (message) =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const admin = makeRedisAdmin(sessions);
    const request = yield* Effect.forkChild(Effect.flip(admin.configGet(["*"])));

    yield* sent(primary, ["CONFIG", "GET", "*"], `-${message}\r\n`);
    const error = yield* Fiber.join(request);
    expect(error).toMatchObject({
      _tag: "ServerError",
      delivery: "replied",
      code: message.split(" ")[0],
    });
    expect(JSON.stringify(error)).not.toContain("private detail");
    expect(yield* primary.written).toHaveLength(1);
    expect(yield* primary.observations).toMatchObject({ closed: 1 });
  }),
);

it.effect("ADMIN: AUTH and SELECT remain lease-local and force physical retirement", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const request = yield* Effect.forkChild(
      sessions.withSession((session) =>
        Effect.gen(function* () {
          yield* session.authenticate({
            username: Redacted.make("user"),
            password: Redacted.make("password"),
          });
          yield* session.selectDatabase(2);
          yield* session.ping();
        }),
      ),
    );

    yield* sent(primary, ["AUTH", "user", "password"], "+OK\r\n");
    yield* sent(primary, ["SELECT", "2"], "+OK\r\n");
    yield* sent(primary, ["PING"], "+PONG\r\n");
    yield* Fiber.join(request);
    expect(yield* primary.observations).toMatchObject({ closed: 1 });
  }),
);
