import { expect, it } from "@effect/vitest";
import { Duration, Effect } from "effect";

import { set } from "#/commands/strings/Set";
import { expiryAfter } from "#/commands/strings/SetOptions";
import type { SetOptions } from "#/commands/strings/SetOptions";
import type { RedisCommand } from "#/protocol/encode";

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
