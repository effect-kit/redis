import { Effect } from "effect";

import { decodeRedisConfig } from "#/RedisConfig";
import type { SessionOptions } from "#/sessions/pool/Options";
import { makeRedisSessions } from "#/sessions/RedisSessions";
import { reconnecting } from "#test/support/connection/Controlled";

export const sessionFixture = Effect.fnUntraced(function* (
  options: SessionOptions = {},
  input: Record<string, unknown> = {},
) {
  const fixture = yield* reconnecting();
  const config = yield* decodeRedisConfig({
    endpoint: { host: "localhost" },
    protocol: "resp2",
    ...input,
  });
  const sessions = yield* makeRedisSessions(config, options).pipe(Effect.provide(fixture.layer));
  const [primary, secondary] = fixture.fixtures;
  if (primary === undefined || secondary === undefined)
    return yield* Effect.die(new Error("Missing controlled session fixtures"));

  return { ...fixture, primary, secondary, config, sessions };
});
