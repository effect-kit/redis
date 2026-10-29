import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import { Commands } from "#/index";
import { sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect(
  "MULTI rejection never writes the transaction's mutations outside transaction state",
  () =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture();
      const request = yield* Effect.forkChild(
        Effect.flip(sessions.transaction([Commands.incr("counter"), Commands.set("key", "value")])),
      );

      yield* sent(primary, ["MULTI"], "-NOPERM denied\r\n");

      expect(yield* Fiber.join(request)).toMatchObject({ _tag: "ServerError", code: "NOPERM" });
      expect(yield* primary.written).toHaveLength(1);
      expect((yield* primary.observations).closed).toBe(1);
    }),
);
