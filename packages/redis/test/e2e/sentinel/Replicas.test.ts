import { expect, it } from "@effect/vitest";
import { Duration, Effect, Option } from "effect";

import { simpleText } from "#/command/reply/Data";
import { makeRedisSentinel } from "#/index";
import { layer } from "#/node";
import { awaitSentinel, sentinelFixture } from "#test/support/sentinel/Fixture";
import { currentSentinelCases } from "#test/support/sentinel/Targets";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(currentSentinelCases)(
  "SENTINEL: $target.fixture $protocol routes explicit replica reads while leases and writes stay primary-bound",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const fixture = yield* sentinelFixture(target, protocol);
      yield* fixture.client.withSession((session) =>
        Effect.gen(function* () {
          yield* session.set("replica-key", "replicated");
          expect(yield* session.waitForReplicas(2, { blockFor: Duration.seconds(2) })).toBe(2n);
        }),
      );
      const clientName = "sentinel-replica-read";
      const reader = yield* makeRedisSentinel(
        { ...fixture.config, data: { ...fixture.config.data, clientName } },
        { ...fixture.clientOptions, readPreference: "replica-preferred" },
      ).pipe(Effect.provide(layer));
      yield* awaitSentinel(
        reader.refresh.pipe(
          Effect.flatMap((view) =>
            view.replicas.length === 2
              ? Effect.void
              : Effect.fail(new Error("Replica discovery pending")),
          ),
        ),
      );
      expect(yield* reader.redis.get("replica-key")).toEqual(Option.some("replicated"));
      const connected: number[] = [];
      for (const server of fixture.servers.slice(0, 3)) {
        const clients = yield* server.request(["CLIENT", "LIST"]).pipe(Effect.flatMap(simpleText));
        if (clients.split("\n").some((line) => line.split(" ").includes(`name=${clientName}`)))
          connected.push(server.index);
      }
      expect(connected).toHaveLength(1);
      expect(connected[0]).not.toBe(0);
      const primary = fixture.servers[0];
      if (primary === undefined) return yield* Effect.die("Missing primary oracle");

      yield* reader.redis.set("primary-write", "primary");
      expect(
        yield* primary.request(["GET", "primary-write"]).pipe(Effect.flatMap(simpleText)),
      ).toBe("primary");

      yield* recordFixture(`sentinel-replica-${target.fixture}-${protocol}`, {
        version: target.version,
        protocol,
        replicaConnections: connected,
        checks: [
          "explicit-stale-read-policy",
          "actual-replica-client-observation",
          "physical-role-verification",
          "primary-write",
          "same-lease-replication-ack",
        ],
      });
    }),
  90_000,
);
