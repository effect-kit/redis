import { Cause, Clock, Effect, Exit, Metric } from "effect";

import type { RedisExecutor } from "#/command/Executor";
import { TelemetrySettings } from "#/telemetry/Options";

const operations = Metric.counter("effect_redis.operations", { incremental: true });
const active = Metric.counter("effect_redis.operations.active");
const duration = Metric.histogram("effect_redis.operation.duration_ms", {
  boundaries: [0, 0.1, 0.5, 1, 2, 5, 10, 50, 100, 500, 1000, 5000, 30000],
});
type Operation = "command" | "pipeline" | "transaction";

const outcome = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit)
    ? "success"
    : Cause.hasDies(exit.cause)
      ? "defect"
      : Cause.hasInterrupts(exit.cause)
        ? "interrupted"
        : "failure";

/** Never derive dimensions, span names or exported failure causes from command/user input. */
export const observe = <A, E, R>(
  operation: Operation,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.flatMap(TelemetrySettings, (options) => {
    if (!options.metrics && !options.tracing) return effect;

    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const started = yield* Clock.currentTimeNanos;
        const span = options.tracing
          ? yield* Effect.makeSpan(`redis.${operation}`, { kind: "client" })
          : undefined;
        if (options.metrics) yield* Metric.update(Metric.withAttributes(active, { operation }), 1);

        return yield* restore(
          span === undefined ? effect : effect.pipe(Effect.withParentSpan(span)),
        ).pipe(
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              const ended = yield* Clock.currentTimeNanos;
              const result = outcome(exit);
              if (options.metrics) {
                yield* Metric.update(Metric.withAttributes(active, { operation }), -1);
                yield* Metric.update(
                  Metric.withAttributes(operations, { operation, outcome: result }),
                  1,
                );
                yield* Metric.update(
                  Metric.withAttributes(duration, { operation }),
                  Math.max(0, Number(ended - started) / 1_000_000),
                );
              }
              // Passing the user's Exit to a tracer can export arbitrary payloads or application errors.
              if (span !== undefined) {
                span.attribute("outcome", result);
                span.end(
                  ended,
                  result === "success"
                    ? Exit.void
                    : Exit.fail({ _tag: "RedisOperationFailure", outcome: result }),
                );
              }
            }),
          ),
        );
      }),
    );
  });

export const observedExecutor = (executor: RedisExecutor): RedisExecutor => ({
  execute: (command) => observe("command", executor.execute(command)),
  executePrepared: (command) => observe("command", executor.executePrepared(command)),
});
