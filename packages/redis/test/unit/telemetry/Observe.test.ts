import { expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Metric, Tracer } from "effect";

import { RedisTelemetry } from "#/index";
import { observe } from "#/telemetry/Observe";

const traceFixture = () => {
  const spans: Tracer.NativeSpan[] = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  return { spans, tracer };
};

it.effect(
  "instrumentation is disabled by default and does not allocate metric series or spans",
  () =>
    Effect.gen(function* () {
      const trace = traceFixture();
      const result = yield* observe("command", Effect.succeed("private-payload")).pipe(
        Effect.provideService(Tracer.Tracer, trace.tracer),
      );

      expect(result).toBe("private-payload");
      expect(trace.spans).toHaveLength(0);
      expect(
        (yield* Metric.snapshot).filter((metric) => metric.id.startsWith("effect_redis.")),
      ).toHaveLength(0);
    }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
);

it.effect(
  "fixed telemetry dimensions preserve values/failures while exporting no application payloads",
  () =>
    Effect.gen(function* () {
      const trace = traceFixture();
      const payload = { secret: "private-application-value" };
      const failure = { secret: "private-application-error" };
      yield* Effect.gen(function* () {
        expect(yield* observe("command", Effect.succeed(payload))).toBe(payload);
        expect(yield* Effect.flip(observe("pipeline", Effect.fail(failure)))).toBe(failure);
        const defect = yield* Effect.exit(observe("transaction", Effect.die(payload)));
        expect(Exit.isFailure(defect) && Cause.hasDies(defect.cause)).toBe(true);
      }).pipe(
        Effect.provide(RedisTelemetry.layer({ tracing: true })),
        Effect.provideService(Tracer.Tracer, trace.tracer),
      );

      expect(trace.spans.map((span) => span.name)).toEqual([
        "redis.command",
        "redis.pipeline",
        "redis.transaction",
      ]);
      const exported = JSON.stringify(trace.spans, (_, value) =>
        typeof value === "bigint" ? String(value) : value,
      );
      expect(exported).not.toContain("private-application");
      expect(trace.spans.map((span) => span.attributes.get("outcome"))).toEqual([
        "success",
        "failure",
        "defect",
      ]);
      const metrics = (yield* Metric.snapshot).filter((metric) =>
        metric.id.startsWith("effect_redis."),
      );
      expect(metrics).toHaveLength(9);
      expect(JSON.stringify(metrics)).not.toContain("private-application");
    }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
);

it.effect("interruption releases the active metric and retains the caller's interrupt Cause", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const fiber = yield* observe(
      "command",
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    ).pipe(Effect.provide(RedisTelemetry.layer()), Effect.forkChild);
    yield* Deferred.await(started);
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);

    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
    const metrics = (yield* Metric.snapshot).filter((metric) =>
      metric.id.startsWith("effect_redis."),
    );
    expect(JSON.stringify(metrics)).toContain("interrupted");
    const active = metrics.find((metric) => metric.id === "effect_redis.operations.active");
    expect(active?.state).toMatchObject({ count: 0 });
  }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
);
