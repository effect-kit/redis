import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "STREAM-GROUP-LIVE: $target.fixture $protocol pending, claims and tombstones",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix } = yield* sessionBackend(target, protocol);
      const key = `${prefix}:stream`;
      yield* redis.xgroupCreate(key, "g", "0", { mkstream: true });
      expect(yield* redis.xgroupCreateconsumer(key, "g", "never-active")).toBe(true);
      expect((yield* redis.xinfoConsumers(key, "g"))[0]).toMatchObject({
        name: bytes("never-active"),
        pending: 0n,
      });
      const first = yield* redis.xadd(key, "1-0", [["f", "v"]]);
      yield* redis.xadd(key, "2-0", [["f", "w"]]);
      expect(yield* redis.xreadgroup("g", "a", [[key, ">"]])).toMatchObject(
        Option.some([{ entries: [{ id: first }, { id: "2-0" }] }]),
      );
      expect(yield* redis.xpending(key, "g")).toMatchObject({
        count: 2n,
        smallest: Option.some(first),
        largest: Option.some("2-0"),
      });
      expect(
        (yield* redis.xpendingEntries(key, "g", { start: "-", end: "+", count: 5 })).map(
          (entry) => entry.id,
        ),
      ).toEqual([first, "2-0"]);
      expect(yield* redis.xclaimIds(key, "g", "b", 0, [first])).toEqual([first]);
      expect(
        Option.getOrThrow((yield* redis.xclaim(key, "g", "b", 0, [first]))[0] ?? Option.none()).id,
      ).toBe(first);
      expect((yield* redis.xautoclaimIds(key, "g", "b", 0)).entries).toEqual([first, "2-0"]);
      yield* redis.xdel(key, ["2-0"]);
      expect(yield* redis.xreadgroup("g", "b", [[key, "0"]])).toMatchObject(
        Option.some([
          {
            entries: [
              { id: first, fields: Option.some([[bytes("f"), bytes("v")]]) },
              { id: "2-0", fields: Option.none() },
            ],
          },
        ]),
      );
      const claimed = yield* redis.xautoclaim(key, "g", "c", 0);
      const legacy = target.product === "redis" && !atLeast(target.version, "7.0.0");
      expect(
        claimed.entries.flatMap((entry) => (Option.isSome(entry) ? [entry.value.id] : [])),
      ).toEqual([first]);
      if (legacy) expect(claimed.entries[1]).toEqual(Option.none());
      expect(claimed.deleted).toEqual(
        target.product === "redis" && !atLeast(target.version, "7.0.0")
          ? Option.none()
          : Option.some(["2-0"]),
      );
      expect(yield* redis.xack(key, "g", [first])).toBe(1n);
      expect(yield* redis.xack(key, "g", ["2-0"])).toBe(legacy ? 1n : 0n);
      expect((yield* redis.xinfoGroups(key))[0]).toMatchObject({ name: bytes("g"), pending: 0n });
      expect((yield* redis.xinfoStreamFull(key)).groups[0]).toMatchObject({ pendingCount: 0n });
      yield* redis.xgroupSetid(key, "g", "0");
      expect(yield* redis.xgroupDelconsumer(key, "g", "never-active")).toBe(0n);
      expect((yield* redis.xgroupHelp()).length).toBeGreaterThan(0);
      expect(yield* redis.xgroupDestroy(key, "g")).toBe(true);
    }),
);
