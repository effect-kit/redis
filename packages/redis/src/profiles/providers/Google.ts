import { profile, selectedModules } from "#/profiles/Profile";
import type { ProfileOptions } from "#/profiles/Profile";

export const memorystoreRedis = (
  options: ProfileOptions & { readonly tls: "required" | "optional" },
) =>
  profile({
    id: "google-memorystore.redis",
    routing: "standalone",
    tls: options.tls,
    authentication: "optional",
    database: "any",
    restrictedCommands: [
      "ACL",
      "BGREWRITEAOF",
      "BGSAVE",
      "CLIENT",
      "CLUSTER",
      "COMMAND",
      "CONFIG",
      "DEBUG",
      "LASTSAVE",
      "MIGRATE",
      "OBJECT",
      "REPLICAOF",
      "SAVE",
      "SHUTDOWN",
    ],
    sources: ["https://docs.cloud.google.com/memorystore/docs/redis/supported-commands"],
    ...selectedModules(options),
  });

export const memorystoreValkey = (
  options: ProfileOptions & {
    readonly routing: "standalone" | "cluster";
    readonly authentication: "optional" | "iam";
    readonly tls: "required" | "optional";
  },
) =>
  profile({
    id: "google-memorystore.valkey",
    routing: options.routing,
    tls: options.tls,
    authentication: options.authentication,
    database: options.routing === "cluster" ? "zero" : "any",
    restrictedCommands: [
      "ACL",
      "BGREWRITEAOF",
      "BGSAVE",
      "CLIENT PAUSE",
      "CLIENT UNPAUSE",
      "CLIENT UNBLOCK",
      "CONFIG SET",
      "CONFIG REWRITE",
      "DEBUG",
      "MIGRATE",
      "REPLICAOF",
      "SAVE",
      "SHUTDOWN",
    ],
    // IAM access-token expiry does not end an already authenticated connection.
    credentialLifetime: { mode: "reconnect" },
    sources: [
      "https://docs.cloud.google.com/memorystore/docs/valkey/supported-commands",
      "https://docs.cloud.google.com/memorystore/docs/valkey/manage-iam-auth",
    ],
    ...selectedModules(options),
  });

export const memorystoreRedisCluster = (
  options: ProfileOptions & {
    readonly authentication: "optional" | "iam";
    readonly tls: "required" | "optional";
  },
) =>
  profile({
    id: "google-memorystore.redis-cluster",
    routing: "cluster",
    tls: options.tls,
    authentication: options.authentication,
    database: "zero",
    restrictedCommands: [],
    credentialLifetime: { mode: "reconnect" },
    sources: ["https://docs.cloud.google.com/memorystore/docs/cluster/manage-iam-auth"],
    ...selectedModules(options),
  });
