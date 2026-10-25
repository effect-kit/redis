import { expect, it } from "@effect/vitest";
import { Context, Effect, Exit, Fiber, Redacted, Ref, Result } from "effect";

import { makeConnection } from "#/connection/Connection";
import { decodeRedisConfig } from "#/RedisConfig";
import { reconnecting, sent, waitForSnapshot } from "#test/support/connection/Controlled";

class Tokens extends Context.Service<Tokens, { readonly next: Effect.Effect<number> }>()(
  "test/connection/Tokens",
) {}

it.effect(
  "HANDSHAKE-11: captures credential services while owning their resources per generation",
  () =>
    Effect.gen(function* () {
      const fixtures = yield* reconnecting();
      const [first, second] = fixtures.fixtures;
      if (first === undefined || second === undefined) return yield* Effect.die("Missing fixture");

      const acquired = yield* Ref.make(0);
      const released = yield* Ref.make(0);

      const credentials = Effect.gen(function* () {
        const tokens = yield* Tokens;
        const id = yield* Effect.acquireRelease(tokens.next, () =>
          Ref.update(released, (count) => count + 1),
        );
        return { password: Redacted.make(`synthetic-${id}`) };
      });

      const config = yield* decodeRedisConfig({
        endpoint: { host: "localhost" },
        protocol: "resp2",
      });
      const opening = yield* Effect.forkChild(
        makeConnection(config, { credentials }).pipe(
          Effect.provide(fixtures.layer),
          Effect.provideService(Tokens, { next: Ref.updateAndGet(acquired, (count) => count + 1) }),
        ),
      );

      yield* sent(first, ["AUTH", "synthetic-1"], "+OK\r\n");
      const connection = yield* Fiber.join(opening);

      yield* first.end;
      yield* waitForSnapshot(connection, (snapshot) => snapshot.state === "failed");

      const request = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
      yield* sent(second, ["AUTH", "synthetic-2"], "+OK\r\n");
      expect(yield* Ref.get(released)).toBe(1);
      yield* sent(second, ["PING"], "+PONG\r\n");
      yield* Fiber.join(request);
      yield* connection.abort;
      expect(yield* Ref.get(acquired)).toBe(2);
      expect(yield* Ref.get(released)).toBe(2);
    }),
);

it.effect.each([
  { reconnectAttempts: 0 },
  { reconnectAttempts: 11 },
  { maxPushBytes: 0 },
  { shutdownTimeoutMillis: -1 },
])("ADMISSION-07: invalid policy fails before transport acquisition %#", (options) =>
  Effect.gen(function* () {
    const fixtures = yield* reconnecting();
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });

    const result = yield* Effect.result(
      makeConnection(config, options).pipe(Effect.provide(fixtures.layer)),
    );

    expect(Result.isFailure(result) && result.failure._tag).toBe("RedisConfigError");
    expect(fixtures.opens()).toBe(0);
  }),
);

it.effect("ADMISSION-08: fixed credentials and an Effect source cannot conflict", () =>
  Effect.gen(function* () {
    const fixtures = yield* reconnecting();
    const config = yield* decodeRedisConfig({
      endpoint: { host: "localhost" },
      credentials: { password: "synthetic-fixed" },
    });

    const result = yield* Effect.result(
      makeConnection(config, {
        credentials: Effect.succeed({ password: Redacted.make("synthetic-dynamic") }),
      }).pipe(Effect.provide(fixtures.layer)),
    );

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: "RedisConfigError",
      field: "connection.credentials",
    });
    expect(fixtures.opens()).toBe(0);
  }),
);

it.effect("HANDSHAKE-12: a credential defect on reconnect stays terminal for future work", () =>
  Effect.gen(function* () {
    const fixtures = yield* reconnecting();
    const first = fixtures.fixtures[0];
    if (first === undefined) return yield* Effect.die("Missing fixture");

    let calls = 0;
    const credentials = Effect.suspend(() =>
      ++calls === 1
        ? Effect.succeed({ password: Redacted.make("synthetic") })
        : Effect.die(new Error("synthetic-credential-defect")),
    );
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" }, protocol: "resp2" });
    const opening = yield* Effect.forkChild(
      makeConnection(config, { credentials }).pipe(Effect.provide(fixtures.layer)),
    );
    yield* sent(first, ["AUTH", "synthetic"], "+OK\r\n");
    const connection = yield* Fiber.join(opening);
    yield* first.end;
    yield* waitForSnapshot(connection, (snapshot) => snapshot.state === "failed");

    for (let iteration = 0; iteration < 2; iteration++) {
      const result = yield* Effect.exit(connection.executeOrdinary(["PING"]));
      expect(Exit.hasDies(result)).toBe(true);
    }

    expect(calls).toBe(2);
    expect((yield* connection.snapshot).cancellations).toBe(0);
    expect(fixtures.opens()).toBe(2);
  }),
);
