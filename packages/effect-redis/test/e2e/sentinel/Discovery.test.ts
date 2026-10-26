import { expect, it } from "@effect/vitest";
import { Effect, Option, Result, Stream } from "effect";

import { Commands } from "#/index";
import { primaryCases } from "#test/support/commands/Backend";
import { sentinelFixture } from "#test/support/sentinel/Fixture";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(primaryCases)(
  "SENTINEL: $target.fixture $protocol discovers primary and preserves typed standalone workflows",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const fixture = yield* sentinelFixture(target, protocol);
      const client = fixture.client;
      yield* client.redis.set("one", "first");
      expect(yield* client.redis.get("one")).toEqual(Option.some("first"));
      expect(yield* client.transaction([Commands.incr("counter"), Commands.get("one")])).toEqual({
        _tag: "Committed",
        results: [Result.succeed(1n), Result.succeed(Option.some("first"))],
      });

      const keys = yield* client.scanKeys({ match: "one", count: 1 }).pipe(Stream.runCollect);
      expect(keys).toEqual([new TextEncoder().encode("one")]);
      yield* client.redis.xgroupCreate("stream", "group", "0", { mkstream: true });
      const id = yield* client.redis.xadd("stream", "*", [["field", "value"]]);
      const consumed = yield* client.streams
        .consume("group", "consumer", ["stream"], () => Effect.succeed("processed"))
        .pipe(Stream.take(1), Stream.runCollect);
      expect(consumed).toMatchObject([
        { _tag: "Processed", message: { entry: { id } }, result: "processed" },
      ]);
      expect((yield* client.redis.xpending("stream", "group")).count).toBe(0n);

      expect(yield* client.sentinel(0).execute(Commands.sentinelMyId())).toHaveLength(40);
      expect(yield* client.sentinel(0).execute(Commands.sentinelMasters())).toHaveLength(1);
      const primary = yield* client
        .sentinel(0)
        .execute(Commands.sentinelGetMasterAddrByName("cache"));
      expect(Option.isSome(primary)).toBe(true);
      expect(yield* client.topology).toMatchObject({
        primary: expect.objectContaining({ port: 6379 }),
      });

      yield* recordFixture(`sentinel-${target.fixture}-${protocol}`, {
        build: fixture.servers.map((server) => server.build),
        configurationDigests: fixture.servers.map((server) => server.configurationDigest),
        protocol,
        target: target.version,
        topology: { data: 3, sentinels: 3 },
        checks: [
          "discovery",
          "role-admission",
          "typed-data",
          "transaction",
          "control-plane",
          "generation-bound-scan",
          "blocking-consumer-ack",
        ],
      });
    }),
  90_000,
);
