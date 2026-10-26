import { profile, selectedModules } from "#/profiles/Profile";
import type { ProfileOptions } from "#/profiles/Profile";

interface RedisEnterpriseOptions extends ProfileOptions {
  readonly routing: "proxy" | "cluster";
  readonly authentication: "password" | "mtls";
}

export const redisCloud = (options: RedisEnterpriseOptions) =>
  profile({
    id: "redis-cloud",
    routing: options.routing,
    tls: "required",
    authentication: options.authentication,
    database: "zero",
    restrictedCommands: [],
    sources: ["https://redis.io/docs/latest/operate/rc/databases/configuration/clustering/"],
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
