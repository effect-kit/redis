import { expect, it } from "@effect/vitest";
import { Context, Effect, Fiber, Redacted, Ref } from "effect";

import { makeRedisSessions } from "#/index";
import { sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

class Tokens extends Context.Service<Tokens, { readonly next: Effect.Effect<number> }>()(
  "test/sessions/Tokens",
) {}

it.effect(
  "SESSION-AUTH: captures services and reacquires scoped credentials for each physical lease",
  () =>
    Effect.gen(function* () {
      const { config, layer, primary, secondary } = yield* sessionFixture();
      const acquired = yield* Ref.make(0);
      const released = yield* Ref.make(0);
      const credentials = Effect.gen(function* () {
        const tokens = yield* Tokens;
        const id = yield* Effect.acquireRelease(tokens.next, () =>
          Ref.update(released, (count) => count + 1),
        );
        return { password: Redacted.make(`synthetic-${id}`) };
      });
      const sessions = yield* makeRedisSessions(config, { connection: { credentials } }).pipe(
        Effect.provide(layer),
        Effect.provideService(Tokens, { next: Ref.updateAndGet(acquired, (count) => count + 1) }),
      );

      const first = yield* Effect.forkChild(sessions.withSession((session) => session.quit()));
      yield* sent(primary, ["AUTH", "synthetic-1"], "+OK\r\n");
      yield* sent(primary, ["QUIT"], "+OK\r\n");
      yield* Fiber.join(first);
      expect(yield* Ref.get(released)).toBe(1);

      const next = yield* Effect.forkChild(sessions.withSession((session) => session.ping()));
      yield* sent(secondary, ["AUTH", "synthetic-2"], "+OK\r\n");
      yield* sent(secondary, ["PING"], "+PONG\r\n");
      yield* Fiber.join(next);
      expect(yield* Ref.get(acquired)).toBe(2);
      expect(yield* Ref.get(released)).toBe(1);

      yield* sessions.close;
      expect(yield* Ref.get(released)).toBe(2);
    }),
);
