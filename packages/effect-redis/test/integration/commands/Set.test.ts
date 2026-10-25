import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { set } from "#/commands/strings/Set";
import type { SetOptions } from "#/commands/strings/SetOptions";
import { commandFixture, respond } from "#test/support/commands/Fixture";

it.effect.each([
  { get: "yes" },
  { condition: "NX XX" },
  { expiry: { type: "EX", value: 0 } },
  { expiry: { type: "PX", value: -1n } },
  { expiry: { type: "PX", value: 1.5 } },
  { expiry: { type: "EX", value: Number.MAX_SAFE_INTEGER + 1 } },
  { expiry: { type: "PXAT", value: 9223372036854775808n } },
  { expiry: { type: "EX", value: 1, PX: 2 } },
  { expiry: { type: "KEEPTTL", value: 1 } },
  { condition: { type: "IFDEQ", digest: "payload-secret" } },
  { condition: { type: "IFEQ", value: 123 } },
  { condition: "NX", nx: true },
])("COMMAND-07: malformed/conflicting options fail before admission %#", (options) =>
  Effect.gen(function* () {
    const { redis, connection } = yield* commandFixture();

    const failure = yield* Effect.flip(redis.set("key", "value", options as unknown as SetOptions));

    expect(failure).toMatchObject({
      _tag: "CommandInputError",
      delivery: "unsent",
      reason: "options",
    });
    expect(JSON.stringify(failure)).not.toContain("payload-secret");
    expect((yield* connection.snapshot).admitted).toBe(0);
  }),
);

it.effect("COMMAND-08: SET results follow validated condition and GET options", () =>
  Effect.gen(function* () {
    const { redis, fixture } = yield* commandFixture();

    expect(
      yield* respond(fixture, redis.set("k", "v"), ["SET", "k", "v"], "+OK\r\n"),
    ).toBeUndefined();
    expect(
      yield* respond(
        fixture,
        redis.set("k", "v", { condition: "NX" }),
        ["SET", "k", "v", "NX"],
        "$-1\r\n",
      ),
    ).toBe(false);
    expect(
      yield* respond(
        fixture,
        redis.set("k", "v", { condition: "XX" }),
        ["SET", "k", "v", "XX"],
        "+OK\r\n",
      ),
    ).toBe(true);
    expect(
      yield* respond(
        fixture,
        redis.set("k", "v", { get: true, condition: "NX" }),
        ["SET", "k", "v", "NX", "GET"],
        "$3\r\nold\r\n",
      ),
    ).toEqual(Option.some(new TextEncoder().encode("old")));
    expect(
      yield* respond(
        fixture,
        redis.set("k", "v", { get: true }),
        ["SET", "k", "v", "GET"],
        "_\r\n",
      ),
    ).toEqual(Option.none());

    const invalid = yield* set("k", "v").prepare;
    expect(yield* Effect.flip(invalid.decode({ _tag: "Null", kind: "bulk" }))).toMatchObject({
      expected: "set-result",
    });

    const old = yield* set("k", "v", { get: true }).prepare;
    expect(
      yield* Effect.flip(
        old.decode({ _tag: "SimpleString", value: new TextEncoder().encode("OK") }),
      ),
    ).toMatchObject({ expected: "blob" });
  }),
);
