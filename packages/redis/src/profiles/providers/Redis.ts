import { profile, selectedModules } from "#/profiles/Profile";
import type { ProfileOptions } from "#/profiles/Profile";

interface RedisEnterpriseOptions extends ProfileOptions {
  readonly routing: "proxy" | "cluster";
  readonly authentication: "password" | "mtls";
}

export type RedisCloudOptions =
  | (RedisEnterpriseOptions & { readonly plan?: "essentials" | "pro" })
  | (ProfileOptions & {
      readonly plan: "free";
      readonly routing: "proxy";
      readonly authentication: "password";
    });

export const redisCloud = (options: RedisCloudOptions) =>
  profile({
    id: options.plan === "free" ? "redis-cloud.free" : "redis-cloud",
    routing: options.routing,
    // The free Essentials plan has no TLS endpoint; paid/default profiles retain verified TLS admission.
    tls: options.plan === "free" ? "optional" : "required",
    authentication: options.authentication,
    database: "zero",
    restrictedCommands: [],
    sources: [
      "https://redis.io/docs/latest/operate/rc/databases/configuration/clustering/",
      "https://redis.io/docs/latest/operate/rc/security/database-security/tls-ssl/",
    ],
    ...selectedModules(options),
  });

export const redisSoftware = (options: RedisEnterpriseOptions) =>
  profile({
    id: "redis-software",
    routing: options.routing,
    tls: "required",
    authentication: options.authentication,
    database: "zero",
    restrictedCommands: [],
    sources: ["https://redis.io/docs/latest/operate/rs/databases/configure/oss-cluster-api/"],
    ...selectedModules(options),
  });
