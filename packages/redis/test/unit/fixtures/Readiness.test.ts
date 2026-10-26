import { expect, it } from "@effect/vitest";
import { Clock, Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";

import { FixtureError } from "#test/support/servers/FixtureError";
import { awaitReadiness } from "#test/support/servers/Readiness";

it.effect("fixture readiness permits startup within its deadline after many quick refusals", () =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    const attempt = Effect.gen(function* () {
      if ((yield* Clock.currentTimeMillis) - started < 4_000)
        return yield* new FixtureError({ stage: "readiness" });
    });
    const waiting = yield* awaitReadiness(attempt).pipe(Effect.result, Effect.forkChild);

    yield* TestClock.adjust(4_000);

    expect(yield* Fiber.join(waiting)).toEqual(Result.succeed(undefined));
  }),
);

it.effect("persistent readiness failures stop at the configured deadline", () =>
  Effect.gen(function* () {
    const waiting = yield* awaitReadiness(
      Effect.fail(new FixtureError({ stage: "readiness" })),
      200,
    ).pipe(Effect.result, Effect.forkChild);

    yield* TestClock.adjust(199);
    expect(waiting.pollUnsafe()).toBeUndefined();

    yield* TestClock.adjust(1);
    const result = yield* Fiber.join(waiting);

    expect(Result.isFailure(result) && result.failure.stage).toBe("server-readiness");
  }),
);

it.effect("the readiness deadline joins a pending probe's cleanup", () =>
  Effect.gen(function* () {
    let released = false;
    const attempt = Effect.never.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          released = true;
        }),
      ),
    );
    const waiting = yield* awaitReadiness(attempt, 200).pipe(Effect.result, Effect.forkChild);

    yield* TestClock.adjust(200);
    const result = yield* Fiber.join(waiting);

    expect(Result.isFailure(result) && result.failure.stage).toBe("server-readiness");
    expect(released).toBe(true);
  }),
);
