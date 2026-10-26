import { Effect, Schema } from "effect";

import { decode } from "#/config/Validation";
import { RedisConfigError } from "#/errors/RedisConfigError";
import { decodeRedisConfig } from "#/RedisConfig";
import type { RedisConfig } from "#/RedisConfig";

export interface SentinelConfig {
  readonly serviceName: string;
  readonly sentinels: readonly [RedisConfig, ...RedisConfig[]];
  /** The endpoint is replaced by discovery; other native data settings are preserved. */
  readonly data: RedisConfig;
}

const Input = Schema.Struct({
  serviceName: Schema.NonEmptyString,
  sentinels: Schema.NonEmptyArray(Schema.Unknown),
  data: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

const EndpointPort = Schema.Struct({
  endpoint: Schema.Union([
    Schema.Struct({ host: Schema.String, port: Schema.optionalKey(Schema.Unknown) }),
    Schema.Struct({ url: Schema.URLFromString }),
  ]),
});

const sentinelEndpoint = Effect.fnUntraced(function* (input: unknown) {
  // Project only port presence; the shared decoder still validates the complete native configuration.
  const selected = yield* Schema.decodeUnknownEffect(EndpointPort, { onExcessProperty: "ignore" })(
    input,
  ).pipe(
    Effect.mapError(
      () =>
        new RedisConfigError({
          field: "sentinel.sentinels",
          reason: "Invalid Sentinel TCP endpoint",
        }),
    ),
  );
  const decoded = yield* decodeRedisConfig(input);
  if (decoded.endpoint._tag !== "Tcp")
    return yield* new RedisConfigError({
      field: "sentinel.sentinels",
      reason: "Sentinel requires TCP",
    });
  const defaultPort =
    "host" in selected.endpoint
      ? selected.endpoint.port === undefined
      : selected.endpoint.url.port === "";

  return defaultPort ? { ...decoded, endpoint: { ...decoded.endpoint, port: 26379 } } : decoded;
});

export const decodeSentinelConfig = Effect.fnUntraced(function* (
  input: unknown,
): Effect.fn.Return<SentinelConfig, RedisConfigError> {
  const selected = yield* decode(Input, "sentinel", input);
  const sentinels = yield* Effect.forEach(selected.sentinels, sentinelEndpoint);
  if (sentinels.some((config) => config.database !== 0 || config.endpoint._tag !== "Tcp"))
    return yield* new RedisConfigError({
      field: "sentinel.sentinels",
      reason: "Sentinel endpoints require TCP and database zero",
    });

  if (selected.data !== undefined && "endpoint" in selected.data)
    return yield* new RedisConfigError({
      field: "sentinel.data",
      reason: "The data endpoint is discovered",
    });
  const data = yield* decodeRedisConfig({
    ...selected.data,
    endpoint: { host: "sentinel.invalid" },
  });

  return {
    serviceName: selected.serviceName,
    sentinels: sentinels as [RedisConfig, ...RedisConfig[]],
    data,
  };
});
