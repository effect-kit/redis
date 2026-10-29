import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option } from "effect";

import { Commands } from "#/index";
import { sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect(
  "session batches and compiled plans retain their exclusive lease and reject escaped execution",
  () =>
    Effect.gen(function* () {
      const { sessions, primary, opens } = yield* sessionFixture();
      const leased = yield* Effect.forkChild(
        sessions.withSession((session) =>
          Effect.gen(function* () {
            const plan = yield* session.compile([Commands.incr("a"), Commands.get("a")]);
            expect(yield* plan.execute()).toEqual([1n, Option.some("1")]);
            expect(yield* session.batch([Commands.get("a")])).toEqual([Option.some("1")]);
            return { plan, empty: yield* session.compile([]) };
          }),
        ),
      );
      yield* sent(primary, ["INCR", "a"]);
      yield* sent(primary, ["GET", "a"], ":1\r\n$1\r\n1\r\n");
      yield* sent(primary, ["GET", "a"], "$1\r\n1\r\n");
      const escaped = yield* Fiber.join(leased);
      expect(opens()).toBe(1);
      expect(yield* Effect.flip(escaped.plan.execute())).toMatchObject({
        _tag: "SessionError",
        reason: "closed",
      });
      expect(yield* Effect.flip(escaped.empty.execute())).toMatchObject({
        _tag: "SessionError",
        reason: "closed",
      });
    }),
);

it.effect("compiled session execution rechecks its configured batch limit", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture({ maxBatchCommands: 1 });
    const leased = yield* Effect.forkChild(
      sessions.withSession((session) =>
        Effect.gen(function* () {
          const plan = yield* session.compile([Commands.get("a"), Commands.get("b")]);
          expect(yield* Effect.flip(plan.execute())).toMatchObject({
            _tag: "SessionError",
            reason: "batch-limit",
          });
          expect(
            yield* Effect.flip(session.batch([Commands.get("a"), Commands.get("b")])),
          ).toMatchObject({ _tag: "SessionError", reason: "batch-limit" });
        }),
      ),
    );
    yield* Fiber.join(leased);
    expect(yield* primary.written).toEqual([]);
  }),
);
