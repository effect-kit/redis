import { expect, it } from "@effect/vitest";
import { Effect, Inspectable, Redacted } from "effect";

import { makeRedisScripts, RedisScript, Reply } from "#/index";
import { cryptoLayer } from "#/node";
import { bytes } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect("SCRIPT: native Crypto hashes an owned source snapshot without exposing its body", () =>
  Effect.gen(function* () {
    const source = bytes("return 1");
    const descriptor = yield* RedisScript.make({ source, decode: Reply.integer }).pipe(
      Effect.provide(cryptoLayer),
    );
    source.fill(0);

    expect(descriptor.sha1).toBe("e0e1f9fabfc9d4800c877a703b823ac0578ff8db");
    expect(Redacted.value(descriptor.source)).toEqual(bytes("return 1"));
    expect(Inspectable.toStringUnknown(descriptor)).not.toContain("return 1");
  }),
);

it.effect("SCRIPT: binary recovery snapshots are bounded before allocation or command writes", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const scripts = yield* makeRedisScripts(sessions, { maxSnapshotBytes: 2 });
    const descriptor = yield* RedisScript.make({ source: "return 1", decode: Reply.integer }).pipe(
      Effect.provide(cryptoLayer),
    );

    expect(yield* Effect.flip(scripts.execute(descriptor, { keys: [bytes("key")] }))).toMatchObject(
      { _tag: "CommandInputError", delivery: "unsent" },
    );
    expect(yield* primary.written).toHaveLength(0);
  }),
);
