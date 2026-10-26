import { Effect } from "effect";

import { ProfileError } from "#/errors/ProfileError";
import { commandPolicy } from "#/profiles/Commands";
import { decodeNetworkPolicy, networkGuard } from "#/profiles/Network";
import type { NetworkPolicy } from "#/profiles/Network";
import { decodeProfile } from "#/profiles/Profile";
import type { DeploymentProfile, Routing } from "#/profiles/Profile";
import type { RedisConfig } from "#/RedisConfig";

export const validateNativeProfile = Effect.fnUntraced(function* (
  config: RedisConfig,
  input: DeploymentProfile | undefined,
  mode: "standalone" | "cluster" | "sentinel",
  dynamicIdentity: boolean,
  hasIdentity: boolean,
  networkInput?: NetworkPolicy,
) {
  const profile = input === undefined ? undefined : yield* decodeProfile(input);
  const network = networkInput === undefined ? undefined : yield* decodeNetworkPolicy(networkInput);
  const deny = networkGuard(network)(config);
  if (deny !== undefined && mode !== "sentinel") return yield* deny;
  if (profile === undefined) return { profile, network };
  if (profile.enabledModules?.some((module) => profile.unsupportedModules.includes(module)))
    return yield* new ProfileError({ delivery: "unsent", reason: "module" });

  const allowed: ReadonlyArray<Routing> = mode === "standalone" ? ["standalone", "proxy"] : [mode];
  if (!allowed.includes(profile.routing))
    return yield* new ProfileError({ delivery: "unsent", reason: "routing" });
  if (
    profile.tls === "required" &&
    (config.endpoint._tag !== "Tcp" ||
      config.endpoint.tls === undefined ||
      !config.endpoint.tls.rejectUnauthorized)
  )
    return yield* new ProfileError({ delivery: "unsent", reason: "tls" });
  if (profile.database === "zero" && config.database !== 0)
    return yield* new ProfileError({ delivery: "unsent", reason: "database" });
  if (["password", "iam", "entra"].includes(profile.authentication) && !hasIdentity)
    return yield* new ProfileError({ delivery: "unsent", reason: "identity" });
  if (["iam", "entra"].includes(profile.authentication)) {
    if (!dynamicIdentity)
      return yield* new ProfileError({ delivery: "unsent", reason: "identity" });
    if (mode !== "standalone" && network === undefined)
      return yield* new ProfileError({ delivery: "unsent", reason: "network-policy" });
  }
  if (
    profile.authentication === "mtls" &&
    (config.endpoint._tag !== "Tcp" ||
      config.endpoint.tls?.certificate === undefined ||
      config.endpoint.tls.privateKey === undefined)
  )
    return yield* new ProfileError({ delivery: "unsent", reason: "identity" });
  if (profile.authentication === "bearer")
    return yield* new ProfileError({ delivery: "unsent", reason: "routing" });
  if (
    config.clientName !== undefined &&
    commandPolicy(profile)(["CLIENT", "SETNAME", config.clientName]) !== undefined
  )
    return yield* new ProfileError({ delivery: "unsent", reason: "restricted-command" });
  return { profile, network };
});
