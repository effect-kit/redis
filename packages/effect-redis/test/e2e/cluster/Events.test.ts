import { expect, it } from "@effect/vitest";
import { Deferred, Duration, Effect, Fiber, Option, Stream } from "effect";

import { simpleText } from "#/command/reply/Data";
import { awaitCluster, clusterFixture } from "#test/support/cluster/Fixture";
import { currentClusterCases } from "#test/support/cluster/Targets";
import { atLeast } from "#test/support/commands/Backend";
import { FixtureError } from "#test/support/servers/FixtureError";

it.live.each(currentClusterCases)(
  "CLUSTER: $target.fixture $protocol Pub/Sub, tracking and replica reads retain node ownership",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { client, nodes } = yield* clusterFixture(target, protocol, {
        cluster: { readPreference: "replica-preferred" },
      });
      const key = "cache{bar}";
      yield* client.redis.set(key, "initial");
      const tracking = yield* client.tracking({ key }, { tracking: { mode: "optin" } });
      const cache = yield* tracking.cache();
      expect(yield* cache.getBytes(key)).toEqual(Option.some(new TextEncoder().encode("initial")));
      yield* client.withSession({ key }, (session) =>
        session
          .set(key, "changed")
          .pipe(Effect.andThen(session.waitForReplicas(1, { blockFor: Duration.seconds(5) }))),
      );
      expect(yield* client.redis.get(key)).toEqual(Option.some("changed"));
      const replica = nodes[3];
      if (replica === undefined) return yield* Effect.die("Missing replica");
      const clients = yield* replica.request(["CLIENT", "LIST"]).pipe(Effect.flatMap(simpleText));
      expect(
        clients.split("\n").some((line) => line.includes("cmd=get") && /flags=\S*r/.test(line)),
      ).toBe(true);
      yield* awaitCluster(
        Effect.gen(function* () {
          if ((yield* cache.snapshot).entries !== 0)
            return yield* new FixtureError({ stage: "cluster-invalidation" });
        }),
      );
      expect(yield* cache.getBytes(key)).toEqual(Option.some(new TextEncoder().encode("changed")));
      expect(yield* Effect.flip(cache.getBytes("foo"))).toMatchObject({
        _tag: "ClusterError",
        reason: "cross-slot",
      });

      const pubsub = yield* client.pubsub({ key });
      const listener = yield* pubsub.subscribe(["global.events"]);
      const message = yield* Effect.forkChild(
        listener.messages.pipe(Stream.take(1), Stream.runCollect),
      );
      yield* client.redis.publish("global.events", new Uint8Array([0, 255]));
      expect((yield* Fiber.join(message))[0]).toMatchObject({ payload: new Uint8Array([0, 255]) });
      yield* listener.close();

      if (atLeast(target.version, "7.0.0")) {
        const sharded = yield* pubsub.ssubscribe(["events{bar}"]);
        const next = yield* Effect.forkChild(
          sharded.messages.pipe(Stream.take(1), Stream.runCollect),
        );
        expect(yield* client.redis.spublish("events{bar}", "sharded")).toBe(1n);
        expect((yield* Fiber.join(next))[0]).toMatchObject({
          payload: new TextEncoder().encode("sharded"),
        });
        yield* sharded.close();
      }
      yield* client.refresh;
      expect(yield* cache.getBytes(key)).toEqual(Option.some(new TextEncoder().encode("changed")));
    }),
  90_000,
);

it.live.each(currentClusterCases)(
  "CLUSTER: $target.fixture $protocol subscription reconnect exposes a gap before readiness",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { client, nodes } = yield* clusterFixture(target, protocol);
      const source = nodes[0];
      if (source === undefined) return yield* Effect.die("Missing primary");
      const pubsub = yield* client.pubsub({ node: source.id });
      const listener = yield* pubsub.subscribe(["gap.events"], { recovery: "resubscribe" });
      const ready = yield* Deferred.make<void>();
      let readyCount = 0;
      const events = yield* Effect.forkChild(
        listener.events.pipe(
          Stream.tap((event) => {
            if (event._tag !== "Ready" || ++readyCount !== 2) return Effect.void;
            return Deferred.succeed(ready, undefined);
          }),
          Stream.take(4),
          Stream.runCollect,
        ),
      );
      yield* source.request(["CLIENT", "KILL", "TYPE", "PUBSUB", "SKIPME", "YES"]);
      yield* Deferred.await(ready);
      yield* client.redis.publish("gap.events", "after-gap");

      const observed = yield* Fiber.join(events);
      expect(observed.map((event) => event._tag)).toEqual([
        "Ready",
        "DeliveryGap",
        "Ready",
        "Message",
      ]);
      yield* listener.close();
    }),
  90_000,
);
