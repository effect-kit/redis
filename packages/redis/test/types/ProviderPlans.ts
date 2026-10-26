import { RedisProfiles } from "#/index";
import type { RedisCloudOptions } from "#/profiles/index";

const free = {
  plan: "free",
  routing: "proxy",
  authentication: "password",
} satisfies RedisCloudOptions;
const paid = {
  plan: "pro",
  routing: "cluster",
  authentication: "mtls",
} satisfies RedisCloudOptions;
RedisProfiles.redisCloud(free);
RedisProfiles.redisCloud(paid);

// @ts-expect-error The free plan exposes a proxy endpoint, not client Cluster routing.
RedisProfiles.redisCloud({ plan: "free", routing: "cluster", authentication: "password" });
// @ts-expect-error Free-plan admission does not imply paid mutual TLS availability.
RedisProfiles.redisCloud({ plan: "free", routing: "proxy", authentication: "mtls" });
// @ts-expect-error Plans must be selected explicitly from the reviewed set.
RedisProfiles.redisCloud({ plan: "unknown", routing: "proxy", authentication: "password" });
