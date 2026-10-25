import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "HIMPORT: $target.fixture $protocol positional fieldsets stay on one physical client",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { sessions, prefix } = yield* sessionBackend(target, protocol);
      const key = `${prefix}:import`;
      if (target.product !== "redis" || !atLeast(target.version, "8.10.0")) {
        expect(
          yield* Effect.flip(
            sessions.withSession((session) => session.himportPrepare("fs", ["field"])),
          ),
        ).toMatchObject({ _tag: "ServerError" });
        return;
      }

      yield* sessions.withSession((session) =>
        Effect.gen(function* () {
          yield* session.hset(key, [["previous", "old"]]);
          yield* session.himportPrepare("fs", ["long-field", new Uint8Array([0, 255]), "a"]);
          yield* session.himportSet(key, "fs", ["z", new Uint8Array([255, 0]), "first"]);
          expect(yield* session.hmget(key, ["long-field", new Uint8Array([0, 255]), "a"])).toEqual([
            Option.some(bytes("z")),
            Option.some(new Uint8Array([255, 0])),
            Option.some(bytes("first")),
          ]);
          expect(yield* session.hexists(key, "previous")).toBe(false);
          expect(yield* Effect.flip(session.himportSet(key, "fs", ["too-few"]))).toMatchObject({
            _tag: "ServerError",
          });
          expect(yield* Effect.flip(session.himportPrepare("duplicate", ["a", "a"]))).toMatchObject(
            { _tag: "ServerError" },
          );
          expect(yield* session.himportDiscard("fs")).toBe(1n);
          expect(yield* session.himportDiscard("fs")).toBe(0n);
          yield* session.himportPrepare("first", ["f"]);
          yield* session.himportPrepare("second", ["f"]);
          expect(yield* session.himportDiscardAll()).toBe(2n);
          yield* session.himportPrepare("retained", ["f"]);
        }),
      );

      expect(
        yield* Effect.flip(
          sessions.withSession((session) => session.himportSet(key, "retained", ["v"])),
        ),
      ).toMatchObject({ _tag: "ServerError" });
    }),
);
