import { profile, selectedModules } from "#/profiles/Profile";
import type { ProfileOptions } from "#/profiles/Profile";

export const aivenValkey = (options: ProfileOptions & { readonly user: "default" | "custom" }) =>
  profile({
    id: `aiven-valkey.${options.user}`,
    routing: "standalone",
    tls: "required",
    authentication: "password",
    database: "any",
    restrictedCommands: options.user === "default" ? ["ACL"] : [],
    sources: [
      "https://aiven.io/docs/products/valkey/howto/connect-valkey-cli",
      "https://aiven.io/docs/products/valkey/howto/configure-acl-permissions",
    ],
    ...selectedModules(options),
  });

export const digitalOceanValkey = (
  options: ProfileOptions & { readonly routing: "standalone" | "cluster" },
) =>
  profile({
    id: "digitalocean-valkey",
    routing: options.routing,
    tls: "required",
    authentication: "password",
    database: options.routing === "cluster" ? "zero" : "any",
    restrictedCommands: [
      "ACL",
      "BGREWRITEAOF",
      "BGSAVE",
      "CONFIG",
      "DEBUG",
      "FAILOVER",
      "LASTSAVE",
      "MIGRATE",
      "MONITOR",
      "REPLICAOF",
      "SAVE",
      "SHUTDOWN",
      "SLAVEOF",
      ...(options.routing === "standalone" ? ["CLUSTER", "COMMAND"] : []),
    ],
    sources: [
      "https://docs.digitalocean.com/products/databases/valkey/details/limits/",
      "https://docs.digitalocean.com/products/databases/valkey/how-to/connect/",
    ],
    ...selectedModules(options),
  });

/** Proprietary Tair structures need separate descriptors; no Redis module alias is inferred. */
export const tair = (
  options: ProfileOptions & {
    readonly edition: "open-source" | "enterprise";
    readonly routing: "standalone" | "proxy" | "cluster";
    readonly tls: "required" | "optional";
  },
) =>
  profile({
    id: `alibaba-tair.${options.edition}`,
    routing: options.routing,
    tls: options.tls,
    authentication: "password",
    database: options.routing === "cluster" ? "zero" : "any",
    restrictedCommands: [],
    sources: ["https://help.aliyun.com/en/redis/developer-reference/overview-3/"],
    ...selectedModules(options),
  });

export const upstash = (options: ProfileOptions & { readonly transport: "native" | "http" }) =>
  profile({
    id: `upstash.${options.transport}`,
    routing: options.transport === "http" ? "http" : "proxy",
    tls: "required",
    authentication: options.transport === "http" ? "bearer" : "password",
    database: "zero",
    restrictedCommands: [],
    unsupportedModules: [],
    sources: [
      "https://upstash.com/docs/redis/overall/compatibility",
      "https://upstash.com/docs/redis/features/restapi",
    ],
    ...selectedModules(options),
  });
