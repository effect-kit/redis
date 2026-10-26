import { Clock, Context, Effect, Fiber, Layer, Redacted } from "effect";

import { nativeLayers } from "#/client/Native";
import type { CredentialLifetime } from "#/credentials/Lifetime";
import { RedisCredentials } from "#/credentials/Manager";
import { Redis, RedisPubSub, RedisSessions } from "#/index";
import { cryptoLayer } from "#/platform/node/Crypto";
import { reconnecting, sent } from "#test/support/connection/Controlled";

export const nativeCredentialFixture = Effect.fnUntraced(function* (
  lifetime: CredentialLifetime = { mode: "reconnect" },
) {
  const fixture = yield* reconnecting();
  let calls = 0;
  const source = RedisCredentials.provider(
    Effect.gen(function* () {
      return {
        password: Redacted.make(`synthetic-${++calls}`),
        expiresAtMillis: (yield* Clock.currentTimeMillis) + 1000,
      };
    }),
    { refreshBeforeMillis: 0 },
  );
  const live = nativeLayers(fixture.layer, cryptoLayer).layer({
    url: "redis://localhost",
    protocol: "resp2",
    credentials: source,
    credentialLifetime: lifetime,
    connection: { reconnectAttempts: 1 },
  });
  const opening = yield* Layer.build(live).pipe(Effect.forkChild);
  const [first, second, third] = fixture.fixtures;
  if (first === undefined || second === undefined || third === undefined)
    return yield* Effect.die("Missing fixture");
  yield* sent(first, ["AUTH", "synthetic-1"], "+OK\r\n");
  const context = yield* Fiber.join(opening);

  return {
    ...fixture,
    first,
    second,
    third,
    redis: Context.get(context, Redis),
    sessions: Context.get(context, RedisSessions),
    pubsub: Context.get(context, RedisPubSub),
    identity: Context.get(context, RedisCredentials),
    calls: () => calls,
  };
});
