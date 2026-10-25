import { Context, Effect, Layer } from "effect";

import type { CacheOptions, RedisCacheClient } from "#/tracking/cache/Cache";
import { RedisTracking } from "#/tracking/RedisTracking";

export class RedisCache extends Context.Service<RedisCache, RedisCacheClient>()(
  "@envoy1084/effect-redis/RedisCache",
) {
  static layer(options?: CacheOptions) {
    return Layer.effect(
      RedisCache,
      RedisTracking.pipe(Effect.flatMap((tracking) => tracking.cache(options))),
    );
  }
}
