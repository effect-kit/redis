import { Effect, Layer } from "effect";
import type { Config } from "effect";
import { FetchHttpClient } from "effect/http";

import type { UpstashConfigInput } from "#/upstash/Config";
import { layer as clientLayer } from "#/upstash/Upstash";

const layer = (input: UpstashConfigInput) =>
  clientLayer(input).pipe(Layer.provide(FetchHttpClient.layer));

export const RedisUpstash = {
  layer,
  layerConfig: (config: Config.Config<UpstashConfigInput>) =>
    Layer.unwrap(Effect.map(config, layer)),
};
