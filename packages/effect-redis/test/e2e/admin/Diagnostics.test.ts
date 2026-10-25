import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { makeRedisAdmin } from "#/index";
import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "ADMIN: $target.fixture $protocol diagnostic and owned destructive operations",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { sessions, redis, prefix } = yield* sessionBackend(target, protocol);
      const admin = makeRedisAdmin(sessions);
      const key = `${prefix}:owned`;

      yield* admin.configSet(Redacted.make([["slowlog-log-slower-than", "0"]]));
      yield* redis.set(key, "value");
      expect(Redacted.value(yield* admin.slowlogGet(-1))).not.toHaveLength(0);
      expect(yield* admin.slowlogLen()).toBeGreaterThan(0n);
      yield* admin.slowlogReset();
      expect(yield* admin.slowlogHelp()).not.toHaveLength(0);
      yield* admin.aclLogReset();
      expect(Redacted.value(yield* admin.aclLog(1))).toEqual([]);
      yield* admin.configResetStat();
      // The fixture deliberately mounts its startup configuration read-only.
      expect(yield* Effect.flip(admin.configRewrite())).toMatchObject({ _tag: "ServerError" });
      expect(yield* admin.latencyDoctor()).not.toHaveLength(0);
      expect(yield* admin.latencyHistory("command")).toBeInstanceOf(Array);
      expect(yield* admin.latencyLatest()).toBeInstanceOf(Array);
      expect(yield* admin.latencyReset()).toBeGreaterThanOrEqual(0n);
      expect(yield* admin.latencyHelp()).not.toHaveLength(0);
      expect(yield* Effect.flip(admin.latencyGraph("effect_missing_event"))).toMatchObject({
        _tag: "ServerError",
      });
      if (atLeast(target.version, "7.0.0"))
        expect(yield* admin.latencyHistogram(["GET"])).toBeInstanceOf(Array);
      expect(yield* admin.lolwut({ version: 6, args: [5, 3] })).not.toHaveLength(0);

      if (target.product === "valkey" && atLeast(target.version, "8.1.0")) {
        expect(yield* admin.commandlogLen("slow")).toBeGreaterThanOrEqual(0n);
        expect(Redacted.value(yield* admin.commandlogGet(5, "large-reply"))).toBeInstanceOf(Array);
        yield* admin.commandlogReset("large-request");
        expect(yield* admin.commandlogHelp()).not.toHaveLength(0);
      } else
        expect(yield* Effect.flip(admin.commandlogLen("slow"))).toMatchObject({
          _tag: "ServerError",
        });

      if (target.product === "redis" && atLeast(target.version, "8.6.0")) {
        yield* admin.hotkeysStart({ metrics: ["CPU", "NET"], count: 5, durationSeconds: 2 });
        yield* redis.get(key);
        expect(Redacted.value(yield* admin.hotkeysGet())).toBeInstanceOf(Array);
        yield* admin.hotkeysStop();
        yield* admin.hotkeysReset();
        expect(yield* admin.hotkeysHelp()).not.toHaveLength(0);
      } else expect(yield* Effect.flip(admin.hotkeysGet())).toMatchObject({ _tag: "ServerError" });

      // These servers belong exclusively to this test; no endpoint/provider mode selects this file.
      yield* admin.save();
      yield* admin.bgsave(true);
      yield* admin.bgrewriteaof();
      yield* admin.swapDb(0, 1);
      yield* admin.swapDb(0, 1);
      yield* admin.flushDb("SYNC");
      expect(yield* admin.dbsize()).toBe(0n);
      yield* redis.set(key, "again");
      yield* admin.flushAll("SYNC");
      expect(yield* admin.dbsize()).toBe(0n);
      yield* admin.replicaOf("NO ONE");
      yield* admin.slaveOf("NO ONE");
      expect(yield* Effect.flip(admin.failover({ abort: true }))).toMatchObject({
        _tag: "ServerError",
      });
      expect(yield* Effect.flip(admin.aclLoad())).toMatchObject({ _tag: "ServerError" });
      expect(yield* Effect.flip(admin.aclSave())).toMatchObject({ _tag: "ServerError" });
      expect(yield* Effect.flip(admin.flushSlots([[0, 1]], "SYNC"))).toMatchObject({
        _tag: "ServerError",
      });
    }),
);
