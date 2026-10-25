import { expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Fiber } from "effect";

import { Commands } from "#/index";
import { sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect("SESSION-CLEANUP: application failure is preserved after UNWATCH", () =>
  Effect.gen(function* () {
    const { sessions, primary, opens } = yield* sessionFixture();
    const request = yield* Effect.forkChild(
      Effect.flip(sessions.watch(["k"], () => Effect.fail("application-failure"))),
    );
    yield* sent(primary, ["WATCH", "k"], "+OK\r\n");
    yield* sent(primary, ["UNWATCH"], "+OK\r\n");
    expect(yield* Fiber.join(request)).toBe("application-failure");

    const next = yield* Effect.forkChild(sessions.withSession((session) => session.ping()));
    yield* sent(primary, ["PING"], "+PONG\r\n");
    yield* Fiber.join(next);
    expect(opens()).toBe(1);
  }),
);

it.effect("SESSION-CLEANUP: rejected UNWATCH retires instead of reusing watched state", () =>
  Effect.gen(function* () {
    const { sessions, primary, secondary, opens } = yield* sessionFixture();
    const request = yield* Effect.forkChild(Effect.flip(sessions.watch(["k"], () => Effect.void)));
    yield* sent(primary, ["WATCH", "k"], "+OK\r\n");
    yield* sent(primary, ["UNWATCH"], "-NOPERM hidden\r\n");
    expect(yield* Fiber.join(request)).toMatchObject({ _tag: "SessionError", reason: "cleanup" });
    expect(yield* primary.observations).toMatchObject({ closed: 1 });

    const next = yield* Effect.forkChild(sessions.withSession((session) => session.ping()));
    yield* sent(secondary, ["PING"], "+PONG\r\n");
    yield* Fiber.join(next);
    expect(opens()).toBe(2);
  }),
);

it.effect("SESSION-CLEANUP: rejected DISCARD retains queue and cleanup failures", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const request = yield* Effect.forkChild(
      Effect.exit(sessions.transaction([Commands.incr("k")])),
    );
    yield* sent(primary, ["MULTI"], "+OK\r\n");
    yield* sent(primary, ["INCR", "k"], "-NOPERM hidden\r\n");
    yield* sent(primary, ["DISCARD"], "-NOPERM hidden\r\n");
    const exit = yield* Fiber.join(request);
    if (exit._tag !== "Failure") return yield* Effect.die("Expected combined failure");
    expect(
      exit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error._tag),
    ).toEqual(["TransactionError", "SessionError"]);
    expect(yield* primary.observations).toMatchObject({ closed: 1 });
  }),
);

it.effect(
  "SESSION-CLEANUP: cancellation after WATCH cleans acknowledged state before retirement",
  () =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture();
      const entered = yield* Deferred.make<void>();
      const request = yield* Effect.forkChild(
        sessions.watch(["k"], () =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        ),
      );
      yield* sent(primary, ["WATCH", "k"], "+OK\r\n");
      yield* Deferred.await(entered);

      const interrupt = yield* Effect.forkChild(Fiber.interrupt(request));
      yield* sent(primary, ["UNWATCH"], "+OK\r\n");
      yield* Fiber.join(interrupt);
      const exit = yield* Fiber.await(request);
      expect(exit._tag === "Failure" && Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(yield* primary.observations).toMatchObject({ closed: 1 });
    }),
);

for (const command of ["WATCH", "MULTI"] as const) {
  it.effect(
    `SESSION-CLEANUP: cancellation before ${command} acknowledgment retires uncertain state`,
    () =>
      Effect.gen(function* () {
        const { sessions, primary } = yield* sessionFixture();
        const request = yield* Effect.forkChild(
          command === "WATCH"
            ? sessions.watch(["k"], () => Effect.void)
            : sessions.transaction([Commands.incr("k")]),
        );
        yield* sent(primary, command === "WATCH" ? [command, "k"] : [command]);
        yield* Fiber.interrupt(request);

        expect(yield* primary.observations).toMatchObject({ closed: 1 });
        expect(yield* primary.written).toHaveLength(1);
      }),
  );
}
