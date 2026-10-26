import { expect, it } from "@effect/vitest";
import { Context, Effect, Fiber, Redacted } from "effect";

import { decodeSentinelConfig } from "#/sentinel/Config";
import { makeRedisSentinel } from "#/sentinel/RedisSentinel";
import { sent } from "#test/support/connection/Controlled";
import { addressReply, primaryRole, sentinelTransport } from "#test/support/sentinel/Controlled";

class Secrets extends Context.Service<
  Secrets,
  { readonly control: string; readonly data: string }
>()("SentinelTestSecrets") {}

it.effect(
  "control and data credentials capture services but own each physical acquisition Scope",
  () =>
    Effect.gen(function* () {
      const fixture = yield* sentinelTransport();
      const config = yield* decodeSentinelConfig({
        serviceName: "cache",
        sentinels: [{ endpoint: { host: "s1" }, protocol: "resp2" }],
        data: { protocol: "resp2" },
      });
      const acquired = { control: 0, data: 0 };
      const released = { control: 0, data: 0 };
      const credentials = (plane: "control" | "data") =>
        Effect.gen(function* () {
          const secrets = yield* Secrets;
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              acquired[plane]++;
            }),
            () =>
              Effect.sync(() => {
                released[plane]++;
              }),
          );
          return { password: Redacted.make(secrets[plane]) };
        });
      const opening = yield* Effect.forkChild(
        makeRedisSentinel(config, {
          discoveryAttempts: 1,
          sentinelConnection: { credentials: credentials("control") },
          connection: { credentials: credentials("data") },
        }).pipe(
          Effect.provide(fixture.layer),
          Effect.provideService(Secrets, { control: "synthetic-control", data: "synthetic-data" }),
        ),
      );
      const discover = Effect.gen(function* () {
        const control = yield* fixture.next;
        expect(control.host).toBe("s1");
        yield* sent(control.fixture, ["AUTH", "synthetic-control"], "+OK\r\n");
        yield* sent(
          control.fixture,
          ["SENTINEL", "GET-MASTER-ADDR-BY-NAME", "cache"],
          addressReply(),
        );
        const probe = yield* fixture.next;
        expect(probe.host).toBe("a");
        yield* sent(probe.fixture, ["AUTH", "synthetic-data"], "+OK\r\n");
        yield* sent(probe.fixture, ["ROLE"], primaryRole);
      });
      yield* discover;
      const client = yield* Fiber.join(opening);
      const write = yield* Effect.forkChild(client.redis.set("key", "value"));
      yield* discover;
      const physical = yield* fixture.next;
      yield* sent(physical.fixture, ["AUTH", "synthetic-data"], "+OK\r\n");
      yield* sent(physical.fixture, ["ROLE"], primaryRole);
      yield* sent(physical.fixture, ["SET", "key", "value"], "+OK\r\n");
      yield* Fiber.join(write);

      expect(acquired).toEqual({ control: 2, data: 3 });
      expect(released).toEqual({ control: 2, data: 2 });
      yield* client.close;
      expect(released).toEqual(acquired);
    }),
);

it.effect.each(["sentinel", "data", "role"] as const)(
  "authentication/ACL rejection retains its %s plane and does not send application commands",
  (plane) =>
    Effect.gen(function* () {
      const fixture = yield* sentinelTransport();
      const config = yield* decodeSentinelConfig({
        serviceName: "cache",
        sentinels: [
          {
            endpoint: { host: "s1" },
            protocol: "resp2",
            ...(plane === "sentinel" ? { credentials: { password: "control-secret" } } : {}),
          },
        ],
        data: {
          protocol: "resp2",
          ...(plane === "data" ? { credentials: { password: "data-secret" } } : {}),
        },
      });
      const opening = yield* Effect.forkChild(
        Effect.flip(
          makeRedisSentinel(config, { discoveryAttempts: 1 }).pipe(Effect.provide(fixture.layer)),
        ),
      );
      const control = yield* fixture.next;
      if (plane === "sentinel")
        yield* sent(control.fixture, ["AUTH", "control-secret"], "-WRONGPASS synthetic-secret\r\n");
      else {
        yield* sent(
          control.fixture,
          ["SENTINEL", "GET-MASTER-ADDR-BY-NAME", "cache"],
          addressReply(),
        );
        const probe = yield* fixture.next;
        if (plane === "data")
          yield* sent(probe.fixture, ["AUTH", "data-secret"], "-WRONGPASS synthetic-secret\r\n");
        else yield* sent(probe.fixture, ["ROLE"], "-NOPERM synthetic-secret\r\n");
      }
      const failure = yield* Fiber.join(opening);

      expect(failure).toMatchObject({
        _tag: "SentinelError",
        reason: "authentication",
        plane: plane === "sentinel" ? "sentinel" : "data",
      });
      expect(JSON.stringify(failure)).not.toContain("synthetic-secret");
      expect(fixture.acquired()).toBe(plane === "sentinel" ? 1 : 2);
    }),
);
