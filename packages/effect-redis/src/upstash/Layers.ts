import { Context, Effect, Layer, Redacted } from "effect";
import type { Config } from "effect";
import { FetchHttpClient } from "effect/http";

import { makeCredentialManager, RedisCredentials } from "#/credentials/Manager";
import { decodeCredentialInput, provider } from "#/credentials/Provider";
import type { CredentialInput } from "#/credentials/Provider";
import { CredentialError } from "#/errors/CredentialError";
import { ProfileError } from "#/errors/ProfileError";
import { UpstashError } from "#/errors/UpstashError";
import { commandPolicy } from "#/profiles/Commands";
import { decodeNetworkPolicy, networkGuard } from "#/profiles/Network";
import type { NetworkPolicy } from "#/profiles/Network";
import { decodeProfile } from "#/profiles/Profile";
import type { DeploymentProfile } from "#/profiles/Profile";
import { makeUpstashServices, upstashContext } from "#/upstash/Build";
import { decodeBearer, decodeUpstashSettings } from "#/upstash/Config";
import type { UpstashSettingsInput } from "#/upstash/Config";

export type UpstashClientInput<R = never> = UpstashSettingsInput &
  (
    | { readonly token: Redacted.Redacted<string>; readonly credentials?: never }
    | { readonly credentials: CredentialInput<R>; readonly token?: never }
  ) & {
    readonly profile?: DeploymentProfile;
    readonly network?: NetworkPolicy;
  };

/** Custom HttpClient composition stays available; the ordinary preset supplies Fetch itself. */
const layerWithHttpClient = <R = never>(input: UpstashClientInput<R>) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const {
        token,
        credentials,
        profile: profileInput,
        network: networkInput,
        ...settings
      } = input;
      const config = yield* decodeUpstashSettings(settings);
      if ((token === undefined) === (credentials === undefined))
        return yield* new UpstashError({
          stage: "config",
          reason: "configuration",
          delivery: "unsent",
        });
      const profile = profileInput === undefined ? undefined : yield* decodeProfile(profileInput);
      if (profile?.enabledModules?.some((module) => profile.unsupportedModules.includes(module)))
        return yield* new ProfileError({ delivery: "unsent", reason: "module" });
      if (
        profile !== undefined &&
        (profile.routing !== "http" || !["bearer", "optional"].includes(profile.authentication))
      )
        return yield* new ProfileError({ delivery: "unsent", reason: "routing" });
      if (profile?.tls === "required" && !config.url.startsWith("https:"))
        return yield* new ProfileError({ delivery: "unsent", reason: "tls" });
      const network =
        networkInput === undefined ? undefined : yield* decodeNetworkPolicy(networkInput);
      const url = new URL(config.url);
      const denied = networkGuard(network)({
        endpoint: {
          _tag: "Tcp",
          host: url.hostname,
          port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
        },
      });
      if (denied !== undefined) return yield* denied;

      const fixed = token === undefined ? undefined : yield* decodeBearer(token);
      const declared = yield* decodeCredentialInput(credentials);
      const manager = yield* makeCredentialManager(
        declared.source ??
          provider(
            Effect.succeed(
              declared.fixed ?? (fixed === undefined ? undefined : { password: fixed }),
            ),
          ),
      );
      const bearer = Effect.gen(function* () {
        const snapshot = yield* manager.get;
        if (snapshot.revision !== manager.revision())
          return yield* new CredentialError({ reason: "rotated" });
        if (snapshot.credentials === undefined)
          return yield* new CredentialError({ reason: "configuration" });
        return yield* decodeBearer(snapshot.credentials.password);
      }).pipe(
        Effect.mapError(
          (cause) =>
            new UpstashError({
              stage: "request",
              reason: "credentials",
              delivery: "unsent",
              cause: Redacted.make(cause),
            }),
        ),
      );
      const { client, http } = yield* makeUpstashServices(config, {
        bearer,
        guard: commandPolicy(profile),
      });
      const rotate = manager.invalidate.pipe(
        Effect.andThen(http.abortCurrent),
        Effect.uninterruptible,
      );
      return upstashContext(client).pipe(Context.add(RedisCredentials, { ...manager, rotate }));
    }),
  );

const layer = <R = never>(input: UpstashClientInput<R>) =>
  layerWithHttpClient(input).pipe(Layer.provide(FetchHttpClient.layer));

export const RedisUpstash = {
  layer,
  layerWithHttpClient,
  layerConfig: <R = never>(config: Config.Config<UpstashClientInput<R>>) =>
    Layer.unwrap(Effect.map(config, layer<R>)),
};
