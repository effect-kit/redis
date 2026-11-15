import { expect, it } from "@effect/vitest";
import { Effect, Inspectable, Redacted } from "effect";
import { Digest, SecureRandom } from "effect/crypto";

import { makeRedisScripts, RedisScript, Reply } from "#/index";
import { cryptoLayer } from "#/node";
import { bytes } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect("SCRIPT: native Digest hashes an owned source snapshot without exposing its body", () =>
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

it.effect("SCRIPT: native cryptoLayer provides Effect Digest and SecureRandom services", () =>
  Effect.gen(function* () {
    const digest = yield* Digest.Digest;
    const random = yield* SecureRandom.SecureRandom;
    const abc = bytes("abc");

    expect(yield* digest.digestHex(Digest.sha256, abc)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(yield* digest.digest(Digest.sha1, abc)).toEqual(
      Uint8Array.from(Buffer.from("a9993e364706816aba3e25717850c26c9cd0d89d", "hex")),
    );
    expect(yield* random.randomBytes(65537)).toHaveLength(65537);
  }).pipe(Effect.provide(cryptoLayer)),
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
