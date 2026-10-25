import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Result } from "effect";

import { Commands } from "#/index";
import type { RedisSession } from "#/index";
import { sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect(
  "SESSION-TX: EXEC preserves individual runtime errors and successful sibling results",
  () =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture();
      const request = yield* Effect.forkChild(
        sessions.transaction([Commands.incr("a"), Commands.lpop("a")]),
      );
      yield* sent(primary, ["MULTI"], "+OK\r\n");
      yield* sent(primary, ["INCR", "a"], "+QUEUED\r\n");
      yield* sent(primary, ["LPOP", "a"], "+QUEUED\r\n");
      yield* sent(primary, ["EXEC"], "*2\r\n:1\r\n-WRONGTYPE hidden\r\n");

      const result = yield* Fiber.join(request);
      expect(result._tag).toBe("Committed");
      if (result._tag !== "Committed") return yield* Effect.die("Unexpected conflict");
      expect(result.results[0]).toEqual(Result.succeed(1n));
      expect(result.results[1]).toMatchObject({
        failure: { _tag: "ServerError", code: "WRONGTYPE" },
      });
    }),
);

it.effect(
  "SESSION-TX: queue rejection discards known state and permits a later clean borrower",
  () =>
    Effect.gen(function* () {
      const { sessions, primary, opens } = yield* sessionFixture();
      const request = yield* Effect.forkChild(
        Effect.flip(sessions.transaction([Commands.incr("a"), Commands.incr("b")])),
      );
      yield* sent(primary, ["MULTI"], "+OK\r\n");
      yield* sent(primary, ["INCR", "a"], "+QUEUED\r\n");
      yield* sent(primary, ["INCR", "b"], "-NOPERM hidden\r\n");
      yield* sent(primary, ["DISCARD"], "+OK\r\n");
      expect(yield* Fiber.join(request)).toMatchObject({
        _tag: "TransactionError",
        reason: "queue-rejected",
        execution: "not-executed",
      });

      const next = yield* Effect.forkChild(sessions.withSession((session) => session.ping()));
      yield* sent(primary, ["PING"], "+PONG\r\n");
      yield* Fiber.join(next);
      expect(opens()).toBe(1);
    }),
);

it.effect(
  "SESSION-TX: WATCH/read/EXEC stays on one lease and null EXEC is an explicit conflict",
  () =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture();
      const request = yield* Effect.forkChild(
        sessions.watch(["a"], (session) =>
          session.get("a").pipe(Effect.andThen(session.transaction([Commands.set("a", "next")]))),
        ),
      );
      yield* sent(primary, ["WATCH", "a"], "+OK\r\n");
      yield* sent(primary, ["GET", "a"], "$3\r\nold\r\n");
      yield* sent(primary, ["MULTI"], "+OK\r\n");
      yield* sent(primary, ["SET", "a", "next"], "+QUEUED\r\n");
      yield* sent(primary, ["EXEC"], "*-1\r\n");
      expect(yield* Fiber.join(request)).toEqual({ _tag: "Conflict" });
    }),
);

it.effect("SESSION-TX: a WATCH callback that returns early is unwatched before reuse", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const request = yield* Effect.forkChild(sessions.watch(["a"], () => Effect.succeed("done")));
    yield* sent(primary, ["WATCH", "a"], "+OK\r\n");
    yield* sent(primary, ["UNWATCH"], "+OK\r\n");
    expect(yield* Fiber.join(request)).toBe("done");
  }),
);

it.effect("SESSION-TX: lost EXEC reply is unknown and is never replayed", () =>
  Effect.gen(function* () {
    const { sessions, primary, opens } = yield* sessionFixture();
    const request = yield* Effect.forkChild(
      Effect.flip(sessions.transaction([Commands.incr("a")])),
    );
    yield* sent(primary, ["MULTI"], "+OK\r\n");
    yield* sent(primary, ["INCR", "a"], "+QUEUED\r\n");
    yield* sent(primary, ["EXEC"]);
    yield* primary.end;
    expect(yield* Fiber.join(request)).toMatchObject({
      _tag: "BatchError",
      phase: "transaction-exec",
      execution: "unknown",
    });
    expect(opens()).toBe(1);
  }),
);

it.effect(
  "SESSION-TX: concurrent session use fails explicitly and escaped clients close with their lease",
  () =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture();
      const captured = yield* Deferred.make<RedisSession>();
      const request = yield* Effect.forkChild(
        sessions.withSession((session) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(captured, session);
            return yield* session.ping();
          }),
        ),
      );
      const session = yield* Deferred.await(captured);
      yield* sent(primary, ["PING"]);
      expect(yield* Effect.flip(session.ping())).toMatchObject({
        reason: "busy",
        delivery: "unsent",
      });
      yield* primary.receive(new TextEncoder().encode("+PONG\r\n"));
      yield* Fiber.join(request);
      expect(yield* Effect.flip(session.ping())).toMatchObject({
        reason: "closed",
        delivery: "unsent",
      });
    }),
);
