import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Result } from "effect";

import { TransportError } from "#/errors/TransportError";
import { Commands } from "#/index";
import { sent } from "#test/support/connection/Controlled";
import { sentinelControlled } from "#test/support/sentinel/Controlled";

it.effect("Sentinel executes typed commands on one verified pooled generation", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelControlled();
    const write = yield* Effect.forkChild(fixture.client.redis.incr("counter"));
    const data = yield* fixture.data();
    expect(data.host).toBe("a");
    yield* sent(data.fixture, ["INCR", "counter"], ":1\r\n");
    expect(yield* Fiber.join(write)).toBe(1n);

    const read = yield* Effect.forkChild(fixture.client.redis.get("counter"));
    yield* sent(data.fixture, ["GET", "counter"], "$1\r\n1\r\n");
    expect(yield* Fiber.join(read)).toEqual(Option.some("1"));
    expect(yield* fixture.client.snapshot).toMatchObject({
      revision: 1,
      pools: 1,
      activeOperations: 0,
    });
  }),
);

it.effect("unknown writes fail once and only future work discovers the replacement", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelControlled();
    const write = yield* Effect.forkChild(Effect.result(fixture.client.redis.incr("counter")));
    const data = yield* fixture.data();
    yield* sent(data.fixture, ["INCR", "counter"]);
    yield* data.fixture.failRead(new TransportError({ stage: "read", reason: "io" }));

    expect(yield* Fiber.join(write)).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ConnectionError", delivery: "possibly-written" },
    });
    expect(yield* fixture.client.snapshot).toMatchObject({ obsolete: true });

    const read = yield* Effect.forkChild(fixture.client.redis.get("counter"));
    yield* fixture.discovery("b");
    const replacement = yield* fixture.data("b");
    expect(replacement.host).toBe("b");
    yield* sent(replacement.fixture, ["GET", "counter"], "$1\r\n1\r\n");

    expect(yield* Fiber.join(read)).toEqual(Option.some("1"));
    expect(yield* fixture.client.snapshot).toMatchObject({ revision: 2, activeOperations: 0 });
  }),
);

it.effect("Sentinel transactions retain standalone multi-key semantics and exact Results", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelControlled();
    const batch = yield* Effect.forkChild(
      fixture.client.transaction([Commands.incr("one"), Commands.get("other")] as const),
    );
    const data = yield* fixture.data();
    yield* sent(data.fixture, ["MULTI"], "+OK\r\n");
    yield* sent(data.fixture, ["INCR", "one"], "+QUEUED\r\n");
    yield* sent(data.fixture, ["GET", "other"], "+QUEUED\r\n");
    yield* sent(data.fixture, ["EXEC"], "*2\r\n:1\r\n$-1\r\n");

    expect(yield* Fiber.join(batch)).toEqual({
      _tag: "Committed",
      results: [Result.succeed(1n), Result.succeed(Option.none())],
    });
  }),
);

it.effect("replacement discovered during acquisition moves only the unstarted callback", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelControlled({ discoveryAttempts: 2 });
    const warm = yield* Effect.forkChild(fixture.client.redis.ping());
    const original = yield* fixture.data();
    yield* sent(original.fixture, ["PING"], "+PONG\r\n");
    yield* Fiber.join(warm);
    yield* original.fixture.failRead(new TransportError({ stage: "read", reason: "io" }));
    yield* Effect.yieldNow;
    let callbacks = 0;
    const reading = yield* Effect.forkChild(
      fixture.client.withSession((session) => {
        callbacks++;
        return session.get("key");
      }),
    );
    // The old pool observes the new address before it can open a physical application socket.
    yield* fixture.discovery("b");
    yield* fixture.discovery("b");
    const replacement = yield* fixture.data("b");
    yield* sent(replacement.fixture, ["GET", "key"], "$5\r\nvalue\r\n");

    expect(yield* Fiber.join(reading)).toEqual(Option.some("value"));
    expect(callbacks).toBe(1);
    expect(yield* fixture.client.snapshot).toMatchObject({ revision: 2, activeOperations: 0 });
  }),
);
