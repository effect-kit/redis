import { profile, selectedModules } from "#/profiles/Profile";
import type { ProfileOptions } from "#/profiles/Profile";

export const azureManagedRedis = (
  options: ProfileOptions & {
    readonly clustering: "oss" | "enterprise" | "non-clustered";
    readonly authentication: "password" | "entra";
  },
) =>
  profile({
    id: `azure-managed-redis.${options.clustering}`,
    routing:
      options.clustering === "oss"
        ? "cluster"
        : options.clustering === "enterprise"
          ? "proxy"
          : "standalone",
    tls: "required",
    authentication: options.authentication,
    database: "zero",
    restrictedCommands: [],
    unsupportedModules: options.clustering === "enterprise" ? [] : ["search"],
    ...(options.authentication === "entra"
      ? { credentialLifetime: { mode: "token-expiry", retireBeforeMillis: 180_000 } as const }
      : {}),
    sources: [
      "https://learn.microsoft.com/en-us/azure/redis/choose-clustering-policy",
      "https://learn.microsoft.com/en-us/azure/redis/entra-for-authentication",
    ],
    ...selectedModules(options),
  });
