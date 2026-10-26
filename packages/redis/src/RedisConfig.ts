import { Effect, Schema } from "effect";

import { Credentials, EndpointInput, normalizeEndpoint } from "#/config/Endpoint";
import type { Endpoint } from "#/config/Endpoint";
import { Limits } from "#/config/Limits";
import { decode, NonNegativeInteger, PositiveInteger } from "#/config/Validation";
import { RedisConfigError } from "#/errors/RedisConfigError";

const ConfigInput = Schema.Struct({
  endpoint: EndpointInput,
  credentials: Schema.optionalKey(Credentials),
  database: Schema.optionalKey(NonNegativeInteger),
  clientName: Schema.optionalKey(Schema.NonEmptyString.check(Schema.isPattern(/^[!-~]+$/))),
  protocol: Schema.Literals(["resp2", "resp3", "auto"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("auto")),
  ),
  connectTimeoutMillis: PositiveInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(10_000))),
  commandTimeoutMillis: PositiveInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(30_000))),
  limits: Limits.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
});

export type RedisConfigInput = typeof ConfigInput.Encoded;

export interface RedisConfig {
  readonly endpoint: Endpoint;
  readonly credentials?: typeof Credentials.Type;
  readonly database: number;
  readonly clientName?: string;
  readonly protocol: "resp2" | "resp3" | "auto";
  readonly connectTimeoutMillis: number;
  readonly commandTimeoutMillis: number;
  readonly limits: Limits;
}

/** Decode once at acquisition. No rejected input, credentials or full URL enter errors. */
export const decodeRedisConfig = Effect.fnUntraced(function* (
  input: unknown,
): Effect.fn.Return<RedisConfig, RedisConfigError> {
  const config = yield* decode(ConfigInput, "config", input);
  const resolved = yield* normalizeEndpoint(config.endpoint);

  if (config.credentials !== undefined && resolved.credentials !== undefined) {
    return yield* new RedisConfigError({
      field: "credentials",
      reason: "Choose URL or explicit credentials",
    });
  }

  if (config.database !== undefined && resolved.database !== undefined) {
    return yield* new RedisConfigError({
      field: "database",
      reason: "Choose URL or explicit database",
    });
  }

  const credentials = config.credentials ?? resolved.credentials;

  return {
    endpoint: resolved.endpoint,
    ...(credentials === undefined ? {} : { credentials }),
    database: config.database ?? resolved.database ?? 0,
    ...(config.clientName === undefined ? {} : { clientName: config.clientName }),
    protocol: config.protocol,
    connectTimeoutMillis: config.connectTimeoutMillis,
    commandTimeoutMillis: config.commandTimeoutMillis,
    limits: config.limits,
  };
});
