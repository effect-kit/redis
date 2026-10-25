import { expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";

import { bytes, sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect("BLOCK-DEADLINE: server timeout is a successful absent value", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const request = yield* Effect.forkChild(
      sessions.blpop(["k"], { blockFor: Duration.millis(25) }),
    );
    yield* sent(primary, ["BLPOP", "k", "0.025"], "*-1\r\n");
    expect(yield* Fiber.join(request)).toEqual(Option.none());
  }),
);

it.effect("BLOCK-DEADLINE: a client deadline retires an uncertain blocking request", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const request = yield* Effect.forkChild(
      Effect.flip(sessions.blpop(["k"], { blockFor: "forever", timeout: Duration.millis(10) })),
    );
    yield* sent(primary, ["BLPOP", "k", "0"]);
    yield* TestClock.adjust(10);
    expect(yield* Fiber.join(request)).toMatchObject({
      reason: "timeout",
      delivery: "possibly-written",
    });
    expect(yield* primary.observations).toMatchObject({ closed: 1 });
  }),
);

it.effect("BLOCK-POOL: a blocked socket leaves the exclusive lane usable", () =>
  Effect.gen(function* () {
    const { sessions, primary, secondary } = yield* sessionFixture({
      maxSessionConnections: 1,
      maxBlockingConnections: 1,
    });
    const blocked = yield* Effect.forkChild(sessions.brpop(["k"], { blockFor: "forever" }));
    yield* sent(primary, ["BRPOP", "k", "0"]);
    const ping = yield* Effect.forkChild(sessions.withSession((session) => session.ping()));
    yield* sent(secondary, ["PING"], "+PONG\r\n");
    yield* Fiber.join(ping);
    yield* primary.receive(bytes("*2\r\n$1\r\nk\r\n$1\r\nv\r\n"));
    expect(yield* Fiber.join(blocked)).toEqual(Option.some([bytes("k"), bytes("v")]));
  }),
);
