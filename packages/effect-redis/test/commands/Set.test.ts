import { expect, it } from "@effect/vitest";
import { Duration, Effect, Option } from "effect";

import { set } from "#/commands/strings/Set";
import { expiryAfter } from "#/commands/strings/SetOptions";
import type { SetOptions } from "#/commands/strings/SetOptions";
import type { RedisCommand } from "#/protocol/encode";
import { commandFixture, respond } from "#test/support/commands/Fixture";

it.effect.each([
  [{}, ["SET", "key", "value"]],
  [
    { condition: "NX", expiry: { type: "EX", value: 10 } },
    ["SET", "key", "value", "NX", "EX", "10"],
  ],
  [
    { condition: "XX", get: true, expiry: { type: "PX", value: 20n } },
    ["SET", "key", "value", "XX", "GET", "PX", "20"],
  ],
  [{ expiry: { type: "EXAT", value: 1234 } }, ["SET", "key", "value", "EXAT", "1234"]],
  [
    { expiry: { type: "PXAT", value: 1234567890123456n } },
    ["SET", "key", "value", "PXAT", "1234567890123456"],
  ],
  [{ expiry: { type: "KEEPTTL" } }, ["SET", "key", "value", "KEEPTTL"]],
  [
    { condition: { type: "IFEQ", value: new Uint8Array([0, 255]) } },
    ["SET", "key", "value", "IFEQ", new Uint8Array([0, 255])],
  ],
  [{ condition: { type: "IFNE", value: "old" } }, ["SET", "key", "value", "IFNE", "old"]],
  [
    { condition: { type: "IFDEQ", digest: "0123456789abcdef" } },
    ["SET", "key", "value", "IFDEQ", "0123456789abcdef"],
  ],
  [
    { condition: { type: "IFDNE", digest: "fedcba9876543210" } },
    ["SET", "key", "value", "IFDNE", "fedcba9876543210"],
  ],
] satisfies ReadonlyArray<readonly [SetOptions, RedisCommand]>)(
  "COMMAND-06: SET encodes reviewed grammar %#",
  ([options, expected]) =>
    Effect.gen(function* () {
      const prepared = yield* set("key", "value", options).prepare;
      expect(prepared.tokens).toEqual(expected);
      expect(prepared.routing).toEqual({
        _tag: "Keys",
        keys: [{ index: 1, access: "read-write" }],
      });
    }),
);
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
it.effect("COMMAND-07: Duration expiry rejects precision loss, zero and infinity", () =>
  Effect.gen(function* () {
    expect(yield* expiryAfter(Duration.seconds(2))).toEqual({ type: "PX", value: 2000 });
    expect(yield* expiryAfter(Duration.nanos(9007199254740991000000n))).toEqual({
      type: "PX",
      value: Number.MAX_SAFE_INTEGER,
    });
    for (const duration of [
      Duration.zero,
      Duration.infinity,
      Duration.nanos(1n),
      Duration.nanos(9007199254740991000001n),
      Duration.millis(-1),
    ])
      expect(yield* Effect.flip(expiryAfter(duration))).toMatchObject({
        _tag: "CommandInputError",
        reason: "options",
      });
  }),
);
