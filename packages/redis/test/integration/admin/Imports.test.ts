import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import { bytes, sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect("HIMPORT: preparation, positional writes and discard stay on one tainted lease", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const request = yield* Effect.forkChild(
      sessions.withSession((session) =>
        Effect.gen(function* () {
          yield* session.himportPrepare("fieldset", ["b", "a"]);
          yield* session.himportSet(bytes("key"), "fieldset", ["last", "first"]);
          expect(yield* session.himportDiscard("fieldset")).toBe(1n);
          expect(yield* session.himportDiscardAll()).toBe(0n);
        }),
      ),
    );

    yield* sent(primary, ["HIMPORT", "PREPARE", "fieldset", "b", "a"], "+OK\r\n");
    yield* sent(primary, ["HIMPORT", "SET", bytes("key"), "fieldset", "last", "first"], "+OK\r\n");
    yield* sent(primary, ["HIMPORT", "DISCARD", "fieldset"], ":1\r\n");
    yield* sent(primary, ["HIMPORT", "DISCARDALL"], ":0\r\n");
    yield* Fiber.join(request);
    expect(yield* primary.observations).toMatchObject({ closed: 1 });
  }),
);

it.effect("HIMPORT: scope interruption cannot return a fieldset-bearing socket to the pool", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const request = yield* Effect.forkChild(
      sessions.withSession((session) =>
        session.himportPrepare("fieldset", ["field"]).pipe(Effect.andThen(Effect.never)),
      ),
    );
    yield* sent(primary, ["HIMPORT", "PREPARE", "fieldset", "field"], "+OK\r\n");
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(request);

    expect(yield* primary.observations).toMatchObject({ closed: 1 });
  }),
);
