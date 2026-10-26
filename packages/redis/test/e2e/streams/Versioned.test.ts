import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "STREAM-VERSIONED: $target.fixture $protocol idempotency, CLAIM and retention policies",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix } = yield* sessionBackend(target, protocol);
      const key = `${prefix}:stream`;
      yield* redis.xadd(key, "1-0", [["f", "first"]]);
      yield* redis.xgroupCreate(key, "g", "0");
      const current = target.product === "redis" && atLeast(target.version, "8.10.0");
      if (!current) {
        for (const operation of [
          redis.xcfgset(key, { idmpDurationSeconds: 60 }),
          redis.xnack(key, "g", "SILENT", ["1-0"]),
          redis.xackdel(key, "g", ["1-0"]),
          redis.xdelex(key, ["1-0"]),
          redis.xread([[key, "0"]], { maxCount: 1, maxSize: 100 }),
          redis.xreadgroupClaim("g", "a", [[key, ">"]], 0),
        ])
          expect(yield* Effect.flip(operation)).toMatchObject({ _tag: "ServerError" });
        return;
      }

      yield* redis.xcfgset(key, { idmpDurationSeconds: 60, idmpMaxSize: 100 });
      const options = {
        idempotency: { mode: "IDMP" as const, producer: "producer", id: "operation" },
      };
      const id = yield* redis.xadd(key, "*", [["f", "second"]], options);
      expect(yield* redis.xadd(key, "*", [["f", "second"]], options)).toBe(id);
      const automatic = { idempotency: { mode: "IDMPAUTO" as const, producer: "automatic" } };
      const autoId = yield* redis.xadd(key, "*", [["f", "third"]], automatic);
      expect(yield* redis.xadd(key, "*", [["f", "third"]], automatic)).toBe(autoId);
      expect(yield* redis.xlen(key)).toBe(3n);

      const read = yield* redis.xreadgroupClaim("g", "a", [[key, ">"]], 0, {
        count: 2,
        maxCount: 2,
        maxSize: 10000,
      });
      expect(Option.getOrThrow(read)[0]?.entries).toMatchObject([
        { id: "1-0", deliveries: 0n },
        { id, deliveries: 0n },
      ]);
      expect(yield* redis.xnack(key, "g", "FAIL", ["1-0"], { retryCount: 2 })).toBe(1n);
      const reclaimed = yield* redis.xreadgroupClaim("g", "b", [[key, ">"]], 999999, { count: 1 });
      expect(Option.getOrThrow(reclaimed)[0]?.entries[0]).toMatchObject({
        id: "1-0",
        deliveries: 2n,
      });
      expect(yield* redis.xackdel(key, "g", ["1-0"], "DELREF")).toEqual([1n]);
      expect(yield* redis.xdelex(key, [id], "KEEPREF")).toEqual([1n]);
      expect(yield* redis.xtrim(key, { by: "MAXLEN", threshold: 0 }, "DELREF")).toBe(1n);
      expect((yield* redis.xinfoStream(key)).idmpDurationSeconds).toEqual(Option.some(60n));
    }),
);
