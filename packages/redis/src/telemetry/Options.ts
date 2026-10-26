import { Context, Effect, Schema } from "effect";

import { RedisConfigError } from "#/errors/RedisConfigError";

export const Options = Schema.Struct({
  metrics: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  tracing: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
});
export type TelemetryOptions = typeof Options.Encoded;

/** Opt-in instrumentation has no mandatory service requirement on existing command Effects. */
export const TelemetrySettings = Context.Reference<typeof Options.Type>(
  "@effect-kit/redis/TelemetrySettings",
  { defaultValue: () => ({ metrics: false, tracing: false }) },
);

export const decodeOptions = (input: unknown) =>
  Schema.decodeUnknownEffect(Options, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError(
      () => new RedisConfigError({ field: "telemetry", reason: "Invalid telemetry options" }),
    ),
  );
