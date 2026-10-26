import { expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Option } from "effect";

import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "BLOCK-LIVE: $target.fixture $protocol blocking variants and ordinary progress",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { sessions, redis, prefix } = yield* sessionBackend(target, protocol);
      const source = `${prefix}:source`;
      const destination = `${prefix}:destination`;
      const options = { blockFor: Duration.millis(25) };
      const binary = new Uint8Array([0, 255]);

      expect(yield* sessions.blpop([source], options)).toEqual(Option.none());
      yield* redis.rpush(source, [binary, "b"]);
      expect(yield* sessions.blpop([source], options)).toEqual(
        Option.some([bytes(source), binary]),
      );
      expect(yield* sessions.brpop([source], options)).toEqual(
        Option.some([bytes(source), bytes("b")]),
      );
      yield* redis.rpush(source, ["c"]);
      expect(yield* sessions.brpoplpush(source, destination, options)).toEqual(
        Option.some(bytes("c")),
      );
      expect(yield* sessions.blmove(destination, source, "LEFT", "RIGHT", options)).toEqual(
        Option.some(bytes("c")),
      );

      if (target.product === "valkey" || atLeast(target.version, "7.0.0")) {
        expect(yield* sessions.blmpop([source], "LEFT", options, 2)).toEqual(
          Option.some([bytes(source), [bytes("c")]]),
        );
        yield* redis.zadd(`${prefix}:sorted`, [
          [2, "b"],
          [1, binary],
        ]);
        expect(yield* sessions.bzmpop([`${prefix}:sorted`], "MAX", options, 2)).toEqual(
          Option.some([
            bytes(`${prefix}:sorted`),
            [
              [bytes("b"), "2"],
              [binary, "1"],
            ],
          ]),
        );
      } else {
        expect(yield* Effect.flip(sessions.blmpop([source], "LEFT", options))).toMatchObject({
          _tag: "ServerError",
        });
        expect(yield* Effect.flip(sessions.bzmpop([source], "MIN", options))).toMatchObject({
          _tag: "ServerError",
        });
        yield* redis.del([source]);
      }

      yield* redis.zadd(`${prefix}:sorted`, [
        [1, binary],
        [2, "b"],
      ]);
      expect(yield* sessions.bzpopmin([`${prefix}:sorted`], options)).toEqual(
        Option.some([bytes(`${prefix}:sorted`), binary, "1"]),
      );
      expect(yield* sessions.bzpopmax([`${prefix}:sorted`], options)).toEqual(
        Option.some([bytes(`${prefix}:sorted`), bytes("b"), "2"]),
      );

      if (target.product === "redis" && atLeast(target.version, "8.10.0")) {
        yield* redis.rpush(source, ["x", "y"]);
        expect(
          yield* sessions.blmovem(source, destination, "LEFT", "RIGHT", options, {
            selection: "EXACTLY",
            count: 2,
            ordering: "BULK",
          }),
        ).toEqual(Option.some([bytes("x"), bytes("y")]));
      } else
        expect(
          yield* Effect.flip(sessions.blmovem(source, destination, "LEFT", "RIGHT", options)),
        ).toMatchObject({ _tag: "ServerError" });

      const blocked = yield* Effect.forkChild(
        sessions.blpop([`${prefix}:waiting`], { blockFor: "forever" }),
      );
      yield* redis.ping();
      yield* redis.rpush(`${prefix}:waiting`, [binary]);
      expect(yield* Fiber.join(blocked)).toEqual(Option.some([bytes(`${prefix}:waiting`), binary]));
      expect(yield* sessions.snapshot).toMatchObject({ leased: 0, waiting: 0 });
    }),
);
