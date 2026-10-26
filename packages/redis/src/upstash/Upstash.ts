import { Effect, Layer } from "effect";

import { makeUpstashServices, upstashContext } from "#/upstash/Build";
import { decodeUpstashConfig } from "#/upstash/Config";
import type { UpstashConfigInput } from "#/upstash/Config";

export const makeUpstash = Effect.fnUntraced(function* (input: UpstashConfigInput) {
  const config = yield* decodeUpstashConfig(input);
  return (yield* makeUpstashServices(config, { bearer: Effect.succeed(config.token) })).client;
});

/** Provides ordinary commands and HTTP batches. Physical RedisSessions are intentionally separate. */
export const layer = (input: UpstashConfigInput) =>
  Layer.effectContext(makeUpstash(input).pipe(Effect.map(upstashContext)));
