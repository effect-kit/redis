import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Metric, Result } from "effect";

import { BatchExecutor, Commands, RedisTelemetry } from "#/index";
import { commandFixture, respond } from "#test/support/commands/Fixture";
import { sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect("facade, prepared and ordinary raw calls each count once with bounded labels", () =>
  Effect.gen(function* () {
    const { redis, fixture } = yield* commandFixture();
    yield* respond(fixture, redis.ping(), ["PING"], "+PONG\r\n");
    const prepared = yield* Commands.ping().prepare;
    yield* respond(fixture, redis.executePrepared(prepared), ["PING"], "+PONG\r\n");
    yield* respond(
      fixture,
      redis.raw(["PING"], {
        execution: "ordinary",
        routing: { _tag: "Keyless" },
      }),
      ["PING"],
      "+PONG\r\n",
    );

    const metrics = (yield* Metric.snapshot).filter((metric) =>
      metric.id.startsWith("effect_redis."),
    );
    expect(metrics).toHaveLength(3);
    expect(metrics.find((metric) => metric.id === "effect_redis.operations")?.state).toMatchObject({
      count: 3,
    });
    expect(
      metrics.find((metric) => metric.id === "effect_redis.operations.active")?.state,
    ).toMatchObject({ count: 0 });
    expect(JSON.stringify(metrics)).not.toContain("PING");
  }).pipe(
    Effect.provide(RedisTelemetry.layer()),
    Effect.provideService(Metric.MetricRegistry, new Map()),
  ),
);

it.effect(
  "batches count once while their individual commands retain actual session execution",
  () =>
    Effect.gen(function* () {
      const { redis } = yield* commandFixture();
      const { sessions, primary } = yield* sessionFixture();
      const pipeline = yield* redis
        .pipeline([Commands.incr("a"), Commands.incr("a")])
        .pipe(Effect.provideService(BatchExecutor, sessions), Effect.forkChild);
      yield* sent(primary, ["INCR", "a"], ":1\r\n");
      yield* sent(primary, ["INCR", "a"], ":2\r\n");
      expect(yield* Fiber.join(pipeline)).toEqual([Result.succeed(1n), Result.succeed(2n)]);

      const transaction = yield* redis
        .transaction([Commands.incr("a")])
        .pipe(Effect.provideService(BatchExecutor, sessions), Effect.forkChild);
      yield* sent(primary, ["MULTI"], "+OK\r\n");
      yield* sent(primary, ["INCR", "a"], "+QUEUED\r\n");
      yield* sent(primary, ["EXEC"], "*1\r\n:3\r\n");
      expect(yield* Fiber.join(transaction)).toMatchObject({
        _tag: "Committed",
        results: [Result.succeed(3n)],
      });

      const completions = (yield* Metric.snapshot).filter(
        (metric) => metric.id === "effect_redis.operations",
      );
      expect(completions).toHaveLength(2);
      expect(completions.map((metric) => metric.state)).toEqual([
        { count: 1, incremental: true },
        { count: 1, incremental: true },
      ]);
    }).pipe(
      Effect.provide(RedisTelemetry.layer()),
      Effect.provideService(Metric.MetricRegistry, new Map()),
    ),
);
