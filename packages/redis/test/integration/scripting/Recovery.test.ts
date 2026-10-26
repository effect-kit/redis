import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Redacted } from "effect";

import { makeRedisScripts, Reply, ServerError } from "#/index";
import type { RedisScript } from "#/scripting/RedisScript";
import { bytes, sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

const script: RedisScript<bigint> = {
  source: Redacted.make(bytes("return 1")),
  sha1: "sha",
  readOnly: false,
  decode: Reply.integer,
};

it.effect("SCRIPT: definite NOSCRIPT loads on the same lease and retries once", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const scripts = yield* makeRedisScripts(sessions);
    const request = yield* Effect.forkChild(scripts.execute(script, { keys: ["k"] }));

    yield* sent(
      primary,
      ["EVALSHA", "sha", "1", "k"],
      "-NOSCRIPT No matching script. Please use EVAL.\r\n",
    );
    yield* sent(primary, ["SCRIPT", "LOAD", "return 1"], "$3\r\nsha\r\n");
    yield* sent(primary, ["EVALSHA", "sha", "1", "k"], ":1\r\n");
    expect(yield* Fiber.join(request)).toBe(1n);

    const hit = yield* Effect.forkChild(scripts.execute(script, { keys: [] }));
    yield* sent(primary, ["EVALSHA", "sha", "0"], ":2\r\n");
    expect(yield* Fiber.join(hit)).toBe(2n);
  }),
);

it.effect.each([
  "ERR mutation already occurred",
  "NOPERM rejected",
  "WRONGTYPE wrong value",
  "NOSCRIPT custom body error",
])(
  "SCRIPT: %s does not authorize recovery without the canonical missing-script response",
  (message) =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture();
      const scripts = yield* makeRedisScripts(sessions);
      const request = yield* Effect.forkChild(Effect.flip(scripts.execute(script, { keys: [] })));
      yield* sent(primary, ["EVALSHA", "sha", "0"], `-${message}\r\n`);
      expect(yield* Fiber.join(request)).toMatchObject({
        _tag: "ServerError",
        delivery: "replied",
      });
      expect(yield* primary.written).toHaveLength(1);
    }),
);

it.effect("SCRIPT: a decoder-produced NOSCRIPT cannot replay a successful mutation", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const scripts = yield* makeRedisScripts(sessions);
    const request = yield* Effect.forkChild(
      Effect.flip(
        scripts.execute(
          {
            ...script,
            decode: () =>
              Effect.fail(
                new ServerError({
                  delivery: "replied",
                  code: "NOSCRIPT",
                  reply: Redacted.make("private"),
                }),
              ),
          },
          { keys: [] },
        ),
      ),
    );

    yield* sent(primary, ["EVALSHA", "sha", "0"], ":1\r\n");
    expect(yield* Fiber.join(request)).toMatchObject({ code: "NOSCRIPT" });
    expect(yield* primary.written).toHaveLength(1);
  }),
);

it.effect("SCRIPT: second missing response terminates recovery", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const scripts = yield* makeRedisScripts(sessions);
    const request = yield* Effect.forkChild(Effect.flip(scripts.execute(script, { keys: [] })));

    yield* sent(
      primary,
      ["EVALSHA", "sha", "0"],
      "-NOSCRIPT No matching script. Please use EVAL.\r\n",
    );
    yield* sent(primary, ["SCRIPT", "LOAD", "return 1"], "$3\r\nsha\r\n");
    yield* sent(
      primary,
      ["EVALSHA", "sha", "0"],
      "-NOSCRIPT No matching script. Please use EVAL.\r\n",
    );
    expect(yield* Fiber.join(request)).toMatchObject({ code: "NOSCRIPT" });
    expect(yield* primary.written).toHaveLength(3);
  }),
);
