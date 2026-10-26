import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { makeRedisSentinel } from "#/index";
import { layer } from "#/node";
import { awaitSentinel, sentinelFixture } from "#test/support/sentinel/Fixture";
import { currentSentinelCases } from "#test/support/sentinel/Targets";
import { recordFixture } from "#test/support/servers/Evidence";
import { certificates } from "#test/support/tls/Certificates";

it.live.each(currentSentinelCases)(
  "SENTINEL: $target.fixture $protocol separates control/data authentication and learns bounded discovery peers",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const fixture = yield* sentinelFixture(target, protocol, { auth: true });
      const client = fixture.client;
      yield* client.redis.set("identity", "valid");
      expect(yield* client.redis.get("identity")).toEqual(Option.some("valid"));
      const first = fixture.config.sentinels[0];
      const wrongControl = {
        ...fixture.config,
        sentinels: [
          { ...first, credentials: { password: Redacted.make("incorrect-control") } },
        ] as const,
      };
      expect(
        yield* Effect.flip(
          makeRedisSentinel(wrongControl, { ...fixture.clientOptions, discoveryAttempts: 1 }).pipe(
            Effect.provide(layer),
          ),
        ),
      ).toMatchObject({ reason: "authentication", plane: "sentinel" });
      const wrongData = {
        ...fixture.config,
        data: {
          ...fixture.config.data,
          credentials: { password: Redacted.make("incorrect-data") },
        },
      };
      expect(
        yield* Effect.flip(
          makeRedisSentinel(wrongData, { ...fixture.clientOptions, discoveryAttempts: 1 }).pipe(
            Effect.provide(layer),
          ),
        ),
      ).toMatchObject({ reason: "authentication", plane: "data" });

      const learned = yield* makeRedisSentinel(
        { ...fixture.config, sentinels: [first] },
        { ...fixture.clientOptions, learnSentinels: true, maxSentinels: 3 },
      ).pipe(Effect.provide(layer));
      yield* awaitSentinel(
        learned.refresh.pipe(
          Effect.andThen(learned.snapshot),
          Effect.flatMap((snapshot) =>
            snapshot.sentinels === 3
              ? Effect.void
              : Effect.fail(new Error("Peer discovery still converging")),
          ),
        ),
      );
      expect(yield* learned.snapshot).toMatchObject({ sentinels: 3 });
      yield* fixture.control(3, "kill");
      yield* learned.refresh;
      expect(yield* learned.redis.get("identity")).toEqual(Option.some("valid"));

      yield* recordFixture(`sentinel-auth-${target.fixture}-${protocol}`, {
        version: target.version,
        protocol,
        checks: [
          "distinct-control-data-secrets",
          "wrong-control-rejected",
          "wrong-data-rejected",
          "learned-peers-bounded",
          "seed-termination-recovery",
        ],
      });
    }),
  90_000,
);

it.live.each(currentSentinelCases)(
  "SENTINEL: $target.fixture $protocol verifies mutual TLS, independent trust failures and fixed database identity",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const tls = yield* certificates();
      const unrelated = yield* certificates();
      const fixture = yield* sentinelFixture(target, protocol, { tls, auth: true, database: 5 });
      yield* fixture.client.redis.set("database-key", "db-five");
      expect(yield* fixture.client.redis.get("database-key")).toEqual(Option.some("db-five"));
      const zero = yield* makeRedisSentinel(
        { ...fixture.config, data: { ...fixture.config.data, database: 0 } },
        fixture.clientOptions,
      ).pipe(Effect.provide(layer));
      expect(yield* zero.redis.get("database-key")).toEqual(Option.none());
      expect(
        yield* Effect.flip(fixture.client.withSession((session) => session.selectDatabase(0))),
      ).toMatchObject({ reason: "routing", plane: "data" });
      const first = fixture.config.sentinels[0];
      if (
        first.endpoint._tag !== "Tcp" ||
        first.endpoint.tls === undefined ||
        fixture.clientOptions.dataTls === undefined
      )
        return yield* Effect.die("Missing TLS fixture policy");
      const wrongSentinel = {
        ...fixture.config,
        sentinels: [
          {
            ...first,
            endpoint: {
              ...first.endpoint,
              tls: { ...first.endpoint.tls, ca: Redacted.make(unrelated.ca) },
            },
          },
        ] as const,
      };
      expect(
        yield* Effect.flip(
          makeRedisSentinel(wrongSentinel, { ...fixture.clientOptions, discoveryAttempts: 1 }).pipe(
            Effect.provide(layer),
          ),
        ),
      ).toMatchObject({ plane: "sentinel" });
      expect(
        yield* Effect.flip(
          makeRedisSentinel(fixture.config, {
            ...fixture.clientOptions,
            discoveryAttempts: 1,
            dataTls: { ...fixture.clientOptions.dataTls, ca: Redacted.make(unrelated.ca) },
          }).pipe(Effect.provide(layer)),
        ),
      ).toMatchObject({ plane: "data" });
      expect(
        yield* Effect.flip(
          makeRedisSentinel(fixture.config, {
            ...fixture.clientOptions,
            discoveryAttempts: 1,
            addressMap: (address, plane) => ({
              ...fixture.addressMap(address, plane),
              ...(plane === "data" ? { serverName: "wrong.invalid" } : {}),
            }),
          }).pipe(Effect.provide(layer)),
        ),
      ).toMatchObject({ plane: "data" });

      yield* recordFixture(`sentinel-tls-db-${target.fixture}-${protocol}`, {
        version: target.version,
        protocol,
        checks: [
          "mutual-tls",
          "independent-control-ca",
          "independent-data-ca",
          "wrong-data-identity",
          "database-zero-five-isolation",
          "fixed-session-database",
        ],
      });
    }),
  90_000,
);
