import { profile, selectedModules } from "#/profiles/Profile";
import type { ProfileOptions } from "#/profiles/Profile";

interface AwsIdentity extends ProfileOptions {
  readonly authentication: "password" | "iam";
}
export type ElastiCacheOptions = AwsIdentity & {
  readonly engine: "redis" | "valkey";
} & (
    | { readonly deployment: "serverless"; readonly routing: "proxy" | "cluster" }
    | { readonly deployment: "replication-group"; readonly routing: "standalone" | "cluster" }
  );

const iamLifetime = {
  mode: "max-age",
  maxAgeMillis: 11 * 60 * 60 * 1000 + 55 * 60 * 1000,
} as const;

/** Topology and engine are explicit: a family name cannot establish discovery or command availability. */
export const elasticache = (options: ElastiCacheOptions) =>
  profile({
    id: `aws-elasticache.${options.engine}.${options.deployment}`,
    routing: options.routing,
    tls: "required",
    authentication: options.authentication,
    database: options.deployment === "serverless" || options.routing === "cluster" ? "zero" : "any",
    restrictedCommands: [
      ...(options.engine === "redis"
        ? [
            "ACL SETUSER",
            "ACL LOAD",
            "ACL SAVE",
            "ACL DELUSER",
            "BGREWRITEAOF",
            "BGSAVE",
            "CONFIG",
            "DEBUG",
            "MIGRATE",
            "PSYNC",
            "REPLICAOF",
            "SAVE",
            "SLAVEOF",
            "SHUTDOWN",
            "SYNC",
          ]
        : []),
      ...(options.deployment === "serverless" ? ["ACL LOG"] : []),
    ],
    ...(options.authentication === "iam" ? { credentialLifetime: iamLifetime } : {}),
    sources: [
      "https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth-iam.html",
      "https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/SupportedCommands.html",
    ],
    ...selectedModules(options),
  });

export const memorydb = (options: AwsIdentity & { readonly engine: "redis" | "valkey" }) =>
  profile({
    id: `aws-memorydb.${options.engine}`,
    routing: "cluster",
    tls: "required",
    authentication: options.authentication,
    database: "zero",
    restrictedCommands: [],
    ...(options.authentication === "iam" ? { credentialLifetime: iamLifetime } : {}),
    sources: ["https://docs.aws.amazon.com/memorydb/latest/devguide/auth-iam.html"],
    ...selectedModules(options),
  });
