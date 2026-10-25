import { Effect, Fiber } from "effect";

import { makeExecutor } from "#/command/Executor";
import type { RedisCommand } from "#/protocol/encode";
import { makeRedis } from "#/Redis";
import { controlled, sent } from "#test/support/connection/Controlled";

export const commandFixture = Effect.fnUntraced(function* () {
  const fixture = yield* controlled();
  const executor = makeExecutor(fixture.connection);
  return { ...fixture, executor, redis: makeRedis(executor) };
});
export const respond = Effect.fnUntraced(function* <A, E, R>(
  fixture: Effect.Success<ReturnType<typeof controlled>>["fixture"],
  request: Effect.Effect<A, E, R>,
  tokens: RedisCommand,
  reply: string,
) {
  const fiber = yield* Effect.forkChild(request);
  yield* sent(fixture, tokens, reply);
  return yield* Fiber.join(fiber);
});
