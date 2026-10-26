import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { Commands } from "#/index";
import type { RedisError } from "#/index";
import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { awaitSentinel, sentinelFixture } from "#test/support/sentinel/Fixture";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(primaryCases)(
  "SENTINEL: $target.fixture $protocol executes versioned inspection/configuration and explicit administration",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const fixture = yield* sentinelFixture(target, protocol);
      const client = fixture.client;
      const control = client.sentinel(0);
      expect(yield* control.execute(Commands.sentinelHelp())).not.toHaveLength(0);
      expect(yield* control.execute(Commands.sentinelMaster("cache"))).not.toHaveLength(0);
      expect(yield* control.execute(Commands.sentinelCkQuorum("cache"))).toContain("OK");
      expect(yield* control.execute(Commands.sentinelPendingScripts())).toEqual([]);
      expect(yield* control.execute(Commands.sentinelInfoCache(["cache"]))).toHaveLength(1);
      expect(yield* control.execute(Commands.sentinelReplicas("cache"))).toHaveLength(2);
      expect(yield* control.execute(Commands.sentinelSlaves("cache"))).toHaveLength(2);
      expect(
        (yield* control.execute(Commands.sentinelSentinels("cache"))).length,
      ).toBeGreaterThanOrEqual(1);
      const primary = fixture.servers[0];
      if (primary === undefined) return yield* Effect.die("Missing primary");
      const peer = yield* control.execute(
        Commands.sentinelIsMasterDownByAddr(primary.address, 6379, 0, "*"),
      );
      expect(peer[0]).toBe(false);
      expect(peer[1]).toBe("*");

      const config = yield* control.execute(Commands.sentinelConfigGet(["resolve-hostnames"]));
      const current = Redacted.value(config)[0];
      if (current === undefined) return yield* Effect.die("Missing Sentinel setting");
      yield* control.execute(Commands.sentinelConfigSet(Redacted.make([current])));
      yield* control.execute(
        Commands.sentinelSet(
          "cache",
          Redacted.make([["down-after-milliseconds", "1000"]] as const),
        ),
      );
      yield* control.execute(Commands.sentinelFlushConfig());
      if (atLeast(target.version, "7.0.0")) {
        const debug = yield* control.execute(Commands.sentinelDebug());
        const setting = debug[0];
        if (setting === undefined) return yield* Effect.die("Missing Sentinel debug setting");
        yield* control.execute(Commands.sentinelDebugSet(Redacted.make([setting])));
      } else
        expect(yield* Effect.flip(control.execute(Commands.sentinelDebug()))).toMatchObject({
          _tag: "ServerError",
          code: "ERR",
        });

      yield* control.execute(Commands.sentinelMonitor("scratch", primary.address, 6379, 2));
      expect(yield* control.execute(Commands.sentinelReset("scratch"))).toBe(1n);
      yield* control.execute(Commands.sentinelRemove("scratch"));
      yield* control.execute(Commands.sentinelSimulateFailure(["crash-after-promotion"]));
      expect(yield* control.execute(Commands.sentinelSimulateFailureHelp())).toContain(
        "crash-after-promotion",
      );

      const aliases: ReadonlyArray<Effect.Effect<unknown, RedisError>> = [
        control.execute(Commands.sentinelGetPrimaryAddrByName("cache")),
        control.execute(Commands.sentinelPrimary("cache")),
        control.execute(Commands.sentinelPrimaries()),
        control.execute(Commands.sentinelIsPrimaryDownByAddr(primary.address, 6379, 0, "*")),
      ];
      for (const operation of aliases) {
        if (target.product === "valkey" && atLeast(target.version, "8.0.0")) yield* operation;
        else
          expect(yield* Effect.flip(operation)).toMatchObject({ _tag: "ServerError", code: "ERR" });
      }
      const before = yield* client.topology;
      const coordinated = target.product === "valkey" && atLeast(target.version, "9.0.0");
      if (!coordinated)
        expect(
          yield* Effect.flip(
            control.execute(Commands.sentinelFailover("cache", { coordinated: true })),
          ),
        ).toMatchObject({ _tag: "ServerError", code: "ERR" });
      yield* control.execute(
        Commands.sentinelFailover("cache", coordinated ? { coordinated: true } : {}),
      );
      yield* awaitSentinel(
        client.refresh.pipe(
          Effect.flatMap((view) =>
            view.primary.host !== before.primary.host
              ? Effect.void
              : Effect.fail(new Error("Explicit failover pending")),
          ),
        ),
      );
      expect(
        Option.isSome(
          yield* client.sentinel(0).execute(Commands.sentinelGetMasterAddrByName("cache")),
        ),
      ).toBe(true);

      yield* recordFixture(`sentinel-admin-${target.fixture}-${protocol}`, {
        version: target.version,
        protocol,
        coordinated,
        valkeyAliases: target.product === "valkey" && atLeast(target.version, "8.0.0"),
        checks: [
          "inspection",
          "redacted-binary-config",
          "debug-availability",
          "owned-monitor-reset-remove",
          "simulation-and-help-reset",
          "peer-vote-query",
          "versioned-aliases",
          "actual-explicit-failover",
        ],
      });
    }),
  90_000,
);
