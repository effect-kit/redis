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

export const decodeSentinelConfig = Effect.fnUntraced(function* (
  input: unknown,
): Effect.fn.Return<SentinelConfig, RedisConfigError> {
  const selected = yield* decode(Input, "sentinel", input);
  const sentinels = yield* Effect.forEach(selected.sentinels, (endpoint) =>
    decodeRedisConfig(endpoint),
  );
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
