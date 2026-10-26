import { Effect, Redacted, Schema } from "effect";

import type { ClusterOptions } from "#/cluster/Options";
import type { Credentials } from "#/config/Endpoint";
import type { ConnectionOptions } from "#/connection/Options";
import { RedisConfigError } from "#/errors/RedisConfigError";
import { decodeRedisConfig } from "#/RedisConfig";
import type { RedisConfigInput } from "#/RedisConfig";
import type { ScriptOptions } from "#/scripting/Options";
import type { SessionOptions } from "#/sessions/pool/Options";
import type { SubscriptionOptions } from "#/subscriptions/Options";

export type NativeAddress =
  | { readonly url: string; readonly endpoint?: never }
  | { readonly endpoint: RedisConfigInput["endpoint"]; readonly url?: never };

export type NativeSettings = Omit<RedisConfigInput, "endpoint" | "credentials">;
export type NativeCredentials = typeof Credentials.Type;

const FixedCredentials = Schema.Struct({
  username: Schema.optionalKey(Schema.Redacted(Schema.String)),
  password: Schema.Redacted(Schema.String),
});

export interface NativeServices<R = never> {
  readonly credentials?: NativeCredentials | ConnectionOptions<R>["credentials"];
  readonly connection?: Omit<ConnectionOptions<R>, "credentials">;
  readonly sessions?: Omit<SessionOptions<R>, "connection">;
  readonly subscriptions?: Omit<SubscriptionOptions<R>, "credentials">;
  readonly scripts?: ScriptOptions;
}

export type NativeClientInput<R = never> = NativeSettings & NativeAddress & NativeServices<R>;
export type NativeClusterInput<R = never> = NativeClientInput<R> & {
  readonly cluster?: Omit<ClusterOptions<R>, "connection" | "sessions">;
};

export const prepareNative = Effect.fnUntraced(function* <R>(input: NativeClientInput<R>) {
  const { url, endpoint, credentials, connection, sessions, subscriptions, scripts, ...settings } =
    input;
  if ((url === undefined) === (endpoint === undefined))
    return yield* new RedisConfigError({ field: "endpoint", reason: "Choose url or endpoint" });

  const dynamic = Effect.isEffect(credentials) ? credentials : undefined;
  const fixed =
    credentials !== undefined && !Effect.isEffect(credentials)
      ? yield* Schema.decodeUnknownEffect(FixedCredentials)(credentials).pipe(
          Effect.mapError(
            () =>
              new RedisConfigError({
                field: "credentials",
                reason: "Expected redacted credentials",
              }),
          ),
        )
      : undefined;
  const config = yield* decodeRedisConfig({
    ...settings,
    endpoint: endpoint ?? { url },
    ...(fixed === undefined
      ? {}
      : {
          credentials: {
            ...(fixed.username === undefined ? {} : { username: Redacted.value(fixed.username) }),
            password: Redacted.value(fixed.password),
          },
        }),
  });

  if (dynamic !== undefined && config.credentials !== undefined)
    return yield* new RedisConfigError({
      field: "credentials",
      reason: "Choose URL credentials or an Effect source",
    });

  return {
    config,
    connection: { ...connection, ...(dynamic === undefined ? {} : { credentials: dynamic }) },
    sessions,
    subscriptions,
    scripts,
  };
});
