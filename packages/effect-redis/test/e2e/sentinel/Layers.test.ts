import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { Redis, RedisCredentials, RedisProfiles, RedisSentinelCredentials } from "#/index";
import { RedisNode } from "#/node";
import { nativeInput } from "#test/support/client/Input";
import { sentinelFixture } from "#test/support/sentinel/Fixture";
import { currentSentinelCases } from "#test/support/sentinel/Targets";
import { certificates } from "#test/support/tls/Certificates";

it.live.each(currentSentinelCases)(
  "READY-SENTINEL: $target.fixture $protocol TLS and distinct credential planes compose in one Layer",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const tls = yield* certificates();
      const fixture = yield* sentinelFixture(target, protocol, { tls, auth: true });
      const first = fixture.config.sentinels[0];
      const control = first.credentials;
      const data = fixture.config.data.credentials;
      if (control === undefined || data === undefined)
        return yield* Effect.die("Missing identities");
      const sentinel = nativeInput(first);
      const {
        endpoint: _endpoint,
        credentials: _credentials,
        ...settings
      } = nativeInput(fixture.config.data);
      const profile = target.product === "redis" ? RedisProfiles.redis : RedisProfiles.valkey;
      const live = RedisNode.layerSentinel({
        serviceName: "cache",
        sentinels: [{ endpoint: sentinel.endpoint, protocol: first.protocol }],
        data: settings,
        credentials: Effect.succeed({ password: Redacted.make(Redacted.value(data.password)) }),
        sentinelCredentials: Effect.succeed({ password: control.password }),
        sentinel: fixture.clientOptions,
        profile: profile({ routing: "sentinel" }),
        network: { allowedHosts: ["127.0.0.1"], allowedServerNames: ["localhost"] },
      });
      yield* Effect.gen(function* () {
        const redis = yield* Redis;
        yield* redis.set("ready-sentinel", "value");
        yield* (yield* RedisSentinelCredentials).rotate;
        expect(yield* redis.get("ready-sentinel")).toEqual(Option.some("value"));
        yield* (yield* RedisCredentials).rotate;
        expect(yield* redis.get("ready-sentinel")).toEqual(Option.some("value"));
      }).pipe(Effect.provide(live));
    }),
  90_000,
);
