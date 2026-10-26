import { Effect, Redacted } from "effect";

import type { ClusterOptions } from "#/cluster/Options";
import type { ConnectionOptions } from "#/connection/Options";
import type { CredentialLifetime } from "#/credentials/Lifetime";
import { decodeCredentialInput, provider } from "#/credentials/Provider";
import type { CredentialInput, CredentialValues } from "#/credentials/Provider";
import { RedisConfigError } from "#/errors/RedisConfigError";
import type { NetworkPolicy } from "#/profiles/Network";
import type { DeploymentProfile } from "#/profiles/Profile";
import { validateNativeProfile } from "#/profiles/Validate";
import { decodeRedisConfig } from "#/RedisConfig";
import type { RedisConfigInput } from "#/RedisConfig";
import type { ScriptOptions } from "#/scripting/Options";
import type { SessionOptions } from "#/sessions/pool/Options";
import type { SubscriptionOptions } from "#/subscriptions/Options";

export type NativeAddress =
  | { readonly url: string; readonly endpoint?: never }
  | { readonly endpoint: RedisConfigInput["endpoint"]; readonly url?: never };

export type NativeSettings = Omit<RedisConfigInput, "endpoint" | "credentials">;
export type NativeCredentials = CredentialValues;

export type { CredentialInput } from "#/credentials/Provider";

export interface NativeServices<R = never> {
  readonly credentials?: CredentialInput<R>;
  readonly credentialLifetime?: CredentialLifetime;
  readonly connection?: Omit<ConnectionOptions<R>, "credentials">;
  readonly sessions?: Omit<SessionOptions<R>, "connection">;
  readonly subscriptions?: Omit<SubscriptionOptions<R>, "credentials">;
  readonly scripts?: ScriptOptions;
  readonly profile?: DeploymentProfile;
  readonly network?: NetworkPolicy;
}

export type NativeClientInput<R = never> = NativeSettings & NativeAddress & NativeServices<R>;
export type NativeClusterInput<R = never> = NativeClientInput<R> & {
  readonly cluster?: Omit<ClusterOptions<R>, "connection" | "sessions">;
};

export const prepareNative = Effect.fnUntraced(function* <R>(
  input: NativeClientInput<R>,
  mode: "standalone" | "cluster" | "sentinel" = "standalone",
) {
  const {
    url,
    endpoint,
    credentials,
    credentialLifetime,
    connection,
    sessions,
    subscriptions,
    scripts,
    profile: profileInput,
    network: networkInput,
    ...settings
  } = input;
  if ((url === undefined) === (endpoint === undefined))
    return yield* new RedisConfigError({ field: "endpoint", reason: "Choose url or endpoint" });

  const { source: dynamic, fixed } = yield* decodeCredentialInput(credentials);
  const decoded = yield* decodeRedisConfig({
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

  if (dynamic !== undefined && decoded.credentials !== undefined)
    return yield* new RedisConfigError({
      field: "credentials",
      reason: "Choose URL credentials or an Effect source",
    });

  const { credentials: fixedIdentity, ...config } = decoded;
  const { profile, network } = yield* validateNativeProfile(
    config,
    profileInput,
    mode,
    dynamic !== undefined,
    credentials !== undefined || fixedIdentity !== undefined,
    networkInput,
  );
  return {
    config,
    source: dynamic ?? provider(Effect.succeed(fixed ?? fixedIdentity)),
    credentialLifetime: credentialLifetime ?? profile?.credentialLifetime,
    profile,
    network,
    connection,
    sessions,
    subscriptions,
    scripts,
  };
});
