import { expect, it } from "@effect/vitest";
import { Context, Effect, Fiber, Layer, Redacted } from "effect";

import { nativeLayers } from "#/client/Native";
import { Commands, Redis, RedisAdmin, RedisProfiles } from "#/index";
import { cryptoLayer } from "#/platform/node/Crypto";
import { restrictedTransport } from "#/profiles/Network";
import { decodeRedisConfig } from "#/RedisConfig";
import { Transport } from "#/transport/Transport";
import { bytes, reconnecting, sent } from "#test/support/connection/Controlled";

it.effect(
  "profile restrictions reject an entire pipeline before its first command is written",
  () =>
    Effect.gen(function* () {
      const fixture = yield* reconnecting();
      const context = yield* Layer.build(
        nativeLayers(fixture.layer, cryptoLayer).layer({
          url: "redis://localhost",
          protocol: "resp2",
          profile: RedisProfiles.memorystoreRedis({ tls: "optional" }),
        }),
      );
      const redis = Context.get(context, Redis);
      const admin = Context.get(context, RedisAdmin);

      const error = yield* Effect.flip(
        redis
          .pipeline([
            Commands.set("private-key", "private-value"),
            Commands.raw(["CONFIG", "GET", "save"], {
              execution: "ordinary",
              routing: { _tag: "Keyless" },
            }),
          ])
          .pipe(Effect.provideContext(context)),
      );
      expect(error).toMatchObject({ _tag: "BatchError", execution: "not-executed" });
      if (error._tag !== "BatchError") return yield* Effect.die("Missing batch evidence");
      expect(Redacted.value(error.outcomes)).toMatchObject([
        { _tag: "Unsent", index: 0 },
        { _tag: "Unsent", index: 1 },
      ]);
      expect(JSON.stringify(error)).not.toContain("private");
      expect(yield* Effect.flip(admin.configGet(["save"]))).toMatchObject({
        reason: "restricted-command",
      });
      for (const physical of fixture.fixtures) expect(yield* physical.written).toEqual([]);

      // Administrative leases are conservatively retired after advanced operations.
      const session = fixture.fixtures[2];
      if (session === undefined) return yield* Effect.die("Missing fixture");
      const healthy = yield* redis
        .pipeline([Commands.ping()])
        .pipe(Effect.provideContext(context), Effect.forkChild);
      yield* sent(session, ["PING"], "+PONG\r\n");
      yield* Fiber.join(healthy);
      expect(fixture.opens()).toBe(3);
    }),
);

it.effect(
  "explicit module gates reject known families while unknown commands retain raw server semantics",
  () =>
    Effect.gen(function* () {
      const fixture = yield* reconnecting();
      const first = fixture.fixtures[0];
      if (first === undefined) return yield* Effect.die("Missing fixture");
      const context = yield* Layer.build(
        nativeLayers(fixture.layer, cryptoLayer).layer({
          url: "redis://localhost",
          protocol: "resp2",
          profile: RedisProfiles.redis({ modules: [] }),
        }),
      );
      const redis = Context.get(context, Redis);
      expect(yield* Effect.flip(redis.jsonGet("private"))).toMatchObject({
        _tag: "ProfileError",
        reason: "module",
      });
      expect(yield* first.written).toEqual([]);

      const custom = yield* redis
        .raw(["FUTURE.OP", "private"], { execution: "ordinary", routing: { _tag: "Keyless" } })
        .pipe(Effect.forkChild);
      yield* sent(first, ["FUTURE.OP", "private"], "-ERR synthetic-unavailable\r\n");
      expect(yield* Fiber.join(custom)).toEqual({
        _tag: "SimpleError",
        value: bytes("ERR synthetic-unavailable"),
      });
    }),
);

it.effect(
  "network and SNI allowlists reject acquisition before dialing or retrieving credentials",
  () =>
    Effect.gen(function* () {
      const fixture = yield* reconnecting();
      let calls = 0;
      const credentials = Effect.sync(() => {
        calls++;
        return { password: Redacted.make("synthetic") };
      });
      const live = nativeLayers(fixture.layer, cryptoLayer).layer({
        url: "rediss://localhost",
        credentials,
        network: { allowedHosts: ["localhost"], allowedServerNames: ["other.example"] },
      });
      expect(yield* Effect.flip(Redis.pipe(Effect.provide(live)))).toMatchObject({
        _tag: "ProfileError",
        reason: "network-policy",
      });
      expect(fixture.opens()).toBe(0);
      expect(calls).toBe(0);

      const transport = yield* Transport.pipe(Effect.provide(fixture.layer));
      const config = yield* decodeRedisConfig({ endpoint: { host: "untrusted.example" } });
      const error = yield* Effect.flip(
        restrictedTransport(transport, { allowedHosts: ["localhost"] }).open(config),
      );
      expect(error).toMatchObject({ _tag: "TransportError", stage: "open", reason: "policy" });
      expect(JSON.stringify(error)).not.toContain("untrusted.example");
      expect(fixture.opens()).toBe(0);
    }),
);
