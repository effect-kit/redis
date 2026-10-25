import { expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Option } from "effect";

import { primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "STREAM-LIVE: $target.fixture $protocol entries, metadata and blocking reads",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, sessions, prefix } = yield* sessionBackend(target, protocol);
      const key = `${prefix}:stream`;
      const binary = new Uint8Array([0, 255]);
      expect(yield* redis.xaddIfExists(key, "*", [["f", binary]])).toEqual(Option.none());
      expect(
        yield* redis.xadd(key, "9007199254740993-1", [
          ["f", binary],
          ["f", "second"],
        ]),
      ).toBe("9007199254740993-1");
      yield* redis.xadd(key, "9007199254740993-2", [["f", "last"]]);
      const entries = yield* redis.xrange(key);
      expect(entries[0]).toEqual({
        id: "9007199254740993-1",
        fields: [
          [bytes("f"), binary],
          [bytes("f"), bytes("second")],
        ],
      });
      expect(yield* redis.xrevrange(key)).toEqual(entries.toReversed());
      expect((yield* redis.xread([[key, "0"]])).pipe(Option.getOrThrow)[0]?.entries).toEqual(
        entries,
      );
      expect(yield* redis.xlen(key)).toBe(2n);
      expect(yield* redis.xinfoStream(key)).toMatchObject({
        length: 2n,
        lastGeneratedId: "9007199254740993-2",
        groups: 0n,
        firstEntry: Option.some(entries[0]),
      });
      expect(yield* redis.xinfoStreamFull(key)).toMatchObject({ entries, groups: [] });
      expect((yield* redis.xinfoHelp()).length).toBeGreaterThan(0);
      expect(
        yield* sessions.xreadBlocking([[key, "9007199254740993-2"]], {
          block: { blockFor: Duration.millis(1) },
        }),
      ).toEqual(Option.none());

      const blocked = yield* Effect.forkChild(
        sessions.xreadBlocking([[`${key}:waiting`, "0"]], { block: { blockFor: "forever" } }),
      );
      yield* redis.ping();
      const added = yield* redis.xadd(`${key}:waiting`, "*", [["f", binary]]);
      expect(yield* Fiber.join(blocked)).toMatchObject(
        Option.some([
          {
            key: bytes(`${key}:waiting`),
            entries: [{ id: added, fields: [[bytes("f"), binary]] }],
          },
        ]),
      );
      expect(yield* redis.xtrim(key, { by: "MAXLEN", threshold: 1 })).toBe(1n);
      expect(yield* redis.xdel(key, ["9007199254740993-2"])).toBe(1n);
    }),
);
