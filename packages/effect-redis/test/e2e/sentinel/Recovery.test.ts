import { expect, it } from "@effect/vitest";
import { Deferred, Duration, Effect, Fiber, Option, Result, Stream } from "effect";

import { decodeReply } from "#/command/Decode";
import { Commands, RedisScript, Reply } from "#/index";
import { cryptoLayer } from "#test/support/commands/Crypto";
import { awaitSentinel, sentinelFixture } from "#test/support/sentinel/Fixture";
import { currentSentinelCases } from "#test/support/sentinel/Targets";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(currentSentinelCases)(
  "SENTINEL: $target.fixture $protocol primary loss retires leases/cache and future work discovers promotion",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const fixture = yield* sentinelFixture(target, protocol, { auth: true });
      const client = fixture.client;
      yield* client.withSession((session) =>
        Effect.gen(function* () {
          yield* session.set("stable", "replicated");
          yield* session.set("counter", "0");
          expect(yield* session.waitForReplicas(2, { blockFor: Duration.seconds(2) })).toBe(2n);
        }),
      );
      const scripts = yield* client.scripts();
      const script = yield* RedisScript.make({
        source: "return redis.call('GET', KEYS[1])",
        decode: Reply.optional(Reply.text),
      }).pipe(Effect.provide(cryptoLayer));
      expect(yield* scripts.execute(script, { keys: ["stable"] })).toEqual(
        Option.some("replicated"),
      );

      const tracking = yield* client.tracking({ tracking: { mode: "optin" } });
      const cache = yield* tracking.cache();
      expect(yield* cache.getBytes("stable")).toEqual(
        Option.some(new TextEncoder().encode("replicated")),
      );

      const oldPubsub = yield* client.pubsub();
      const oldSubscription = yield* oldPubsub.subscribe(["before-failover"]);

      const leased = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const held = yield* Effect.forkChild(
        Effect.result(
          client.withSession((session) =>
            Effect.gen(function* () {
              yield* session.watch(["counter"]);
              yield* Deferred.succeed(leased, undefined);
              yield* Deferred.await(release);
              return yield* session.incr("counter");
            }),
          ),
        ),
      );
      yield* Deferred.await(leased);
      const before = yield* client.topology;
      yield* fixture.control(0, "kill");
      const control = fixture.servers[3];
      if (control === undefined) return yield* Effect.die("Missing Sentinel oracle");
      const address = yield* Commands.sentinelGetMasterAddrByName("cache").prepare;
      yield* awaitSentinel(
        control.request(address.tokens).pipe(
          Effect.flatMap((reply) => decodeReply(address, reply)),
          Effect.flatMap((answer) =>
            Option.isSome(answer) &&
            (answer.value.host !== before.primary.host || answer.value.port !== before.primary.port)
              ? Effect.void
              : Effect.fail(new Error("Promotion not visible yet")),
          ),
        ),
      );
      expect(yield* client.redis.get("stable")).toEqual(Option.some("replicated"));
      yield* Deferred.succeed(release, undefined);

      expect(yield* Fiber.join(held)).toMatchObject({ _tag: "Failure" });
      expect(yield* cache.snapshot).toMatchObject({ active: false, entries: 0 });
      expect(yield* Effect.flip(cache.getBytes("stable"))).toMatchObject({
        reason: "topology-changed",
      });
      expect(yield* Effect.flip(oldSubscription.messages.pipe(Stream.runDrain))).toMatchObject({
        reason: "topology-changed",
      });
      expect(yield* client.redis.get("stable")).toEqual(Option.some("replicated"));
      expect(yield* client.redis.incr("counter")).toBe(1n);

      expect(yield* scripts.execute(script, { keys: ["stable"] })).toEqual(
        Option.some("replicated"),
      );
      const pubsub = yield* client.pubsub();
      const subscription = yield* pubsub.subscribe(["after-failover"]);
      yield* client.redis.publish("after-failover", "new-owner");
      const messages = yield* subscription.messages.pipe(Stream.take(1), Stream.runCollect);
      expect(messages[0]?.payload).toEqual(new TextEncoder().encode("new-owner"));
      yield* subscription.close();
      expect(yield* client.pipeline([Commands.get("stable"), Commands.get("counter")])).toEqual([
        Result.succeed(Option.some("replicated")),
        Result.succeed(Option.some("1")),
      ]);

      yield* recordFixture(`sentinel-failover-${target.fixture}-${protocol}`, {
        protocol,
        version: target.version,
        configurationDigests: fixture.servers.map((server) => server.configurationDigest),
        checks: [
          "actual-primary-termination",
          "independent-promotion",
          "old-lease-failed",
          "cache-retired",
          "new-owner-data",
          "script",
          "pubsub",
        ],
      });
    }),
  90_000,
);

it.live.each(currentSentinelCases.filter(({ protocol }) => protocol === "resp3"))(
  "SENTINEL: $target.fixture established-link partition discovers promotion while the isolated primary retains its role",
  ({ target }) =>
    Effect.gen(function* () {
      const fixture = yield* sentinelFixture(target, "resp3", { proxy: true });
      const client = fixture.client;
      yield* client.withSession((session) =>
        session
          .set("key", "baseline")
          .pipe(Effect.andThen(session.waitForReplicas(2, { blockFor: Duration.seconds(2) }))),
      );
      const before = yield* client.topology;
      yield* fixture.partition(0);
      const address = yield* Commands.sentinelGetMasterAddrByName("cache").prepare;
      // One Sentinel observing promotion does not imply that every candidate has converged.
      for (const control of fixture.servers.slice(3))
        yield* awaitSentinel(
          control.request(address.tokens).pipe(
            Effect.flatMap((reply) => decodeReply(address, reply)),
            Effect.flatMap((answer) =>
              Option.isSome(answer) && answer.value.port !== before.primary.port
                ? Effect.void
                : Effect.fail(new Error("Partition promotion pending")),
            ),
          ),
        );
      yield* client.refresh;
      const after = yield* client.topology;
      expect(after.primary).not.toEqual(before.primary);
      expect(yield* client.redis.get("key")).toEqual(Option.some("baseline"));
      const isolated = fixture.servers[0];
      if (isolated === undefined) return yield* Effect.die("Missing isolated primary oracle");

      // The isolated old primary may still report master; ROLE is not a write-fencing protocol.
      expect(yield* isolated.request(["ROLE"])).toMatchObject({
        _tag: "Array",
        values: [
          { _tag: "BlobString", value: new TextEncoder().encode("master") },
          expect.anything(),
          expect.anything(),
        ],
      });
      yield* recordFixture(`sentinel-partition-${target.fixture}`, {
        version: target.version,
        checks: [
          "established-peer-links-cut",
          "independent-promotion",
          "new-owner-discovery",
          "standalone-fencing-limit",
        ],
      });
    }),
  90_000,
);
