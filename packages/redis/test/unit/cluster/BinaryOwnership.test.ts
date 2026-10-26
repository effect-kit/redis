import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { integer } from "#/command/reply/Scalars";
import { make } from "#/scripting/RedisScript";
import { snapshotArguments } from "#/scripting/Snapshot";
import { cryptoLayer } from "#test/support/commands/Crypto";

it.effect(
  "script source and recovery arguments own Buffer bytes rather than Buffer.slice views",
  () =>
    Effect.gen(function* () {
      const source = Buffer.from("return 1");
      const argument = Buffer.from("foo");
      const script = yield* make({ source, decode: integer }).pipe(Effect.provide(cryptoLayer));
      const snapshot = yield* snapshotArguments({ keys: [argument], args: [argument] }, 6);

      source.fill(0);
      argument.fill(0);

      expect(Redacted.value(script.source)).toEqual(new TextEncoder().encode("return 1"));
      expect(snapshot.keys[0]).toEqual(new TextEncoder().encode("foo"));
      expect(snapshot.args[0]).toEqual(new TextEncoder().encode("foo"));
    }),
);
