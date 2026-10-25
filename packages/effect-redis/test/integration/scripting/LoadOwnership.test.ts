import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Redacted } from "effect";

import { makeRedisScripts, Reply, TransportError } from "#/index";
import type { RedisScript } from "#/scripting/RedisScript";
import { bytes, sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

const script: RedisScript<bigint> = {
  source: Redacted.make(bytes("return 1")),
  sha1: "sha",
  readOnly: false,
  decode: Reply.integer,
};
const missing = "-NOSCRIPT No matching script.\r\n";

it.effect("SCRIPT: concurrent same-backend cache misses share one load receipt", () =>
  Effect.gen(function* () {
    const { sessions, primary, secondary } = yield* sessionFixture({ maxSessionConnections: 2 });
    const scripts = yield* makeRedisScripts(sessions);
    const first = yield* Effect.forkChild(scripts.execute(script, { keys: [] }));
    yield* sent(primary, ["EVALSHA", "sha", "0"], missing);
    const load = yield* primary.nextWrite;
    const second = yield* Effect.forkChild(scripts.execute(script, { keys: [] }));
    yield* sent(secondary, ["EVALSHA", "sha", "0"], missing);
    yield* Effect.yieldNow;
    expect(yield* secondary.written).toHaveLength(1);

    yield* load.accept(load.bytes.length);
    yield* primary.receive(bytes("$3\r\nsha\r\n"));
    yield* sent(primary, ["EVALSHA", "sha", "0"], ":1\r\n");
    yield* sent(secondary, ["EVALSHA", "sha", "0"], ":2\r\n");
    expect(yield* Fiber.join(first)).toBe(1n);
    expect(yield* Fiber.join(second)).toBe(2n);
    expect(yield* primary.written).toHaveLength(3);
    expect(yield* secondary.written).toHaveLength(2);
  }),
);

it.effect("SCRIPT: distinct load admission is bounded while an existing loader owns the wire", () =>
  Effect.gen(function* () {
    const { sessions, primary, secondary } = yield* sessionFixture({ maxSessionConnections: 2 });
    const scripts = yield* makeRedisScripts(sessions, { maxConcurrentLoads: 1 });
    const first = yield* Effect.forkChild(scripts.execute(script, { keys: [] }));
    yield* sent(primary, ["EVALSHA", "sha", "0"], missing);
    const load = yield* primary.nextWrite;
    const second = yield* Effect.forkChild(
      Effect.flip(scripts.execute({ ...script, sha1: "other" }, { keys: [] })),
    );
    yield* sent(secondary, ["EVALSHA", "other", "0"], missing);

    expect(yield* Fiber.join(second)).toMatchObject({
      _tag: "SessionError",
      reason: "pool-full",
      delivery: "unsent",
    });
    yield* load.accept(load.bytes.length);
    yield* primary.receive(bytes("$3\r\nsha\r\n"));
    yield* sent(primary, ["EVALSHA", "sha", "0"], ":1\r\n");
    expect(yield* Fiber.join(first)).toBe(1n);
  }),
);

it.effect("SCRIPT: loader cancellation completes waiting misses and cannot leak retry work", () =>
  Effect.gen(function* () {
    const { sessions, primary, secondary } = yield* sessionFixture({ maxSessionConnections: 2 });
    const scripts = yield* makeRedisScripts(sessions);
    const first = yield* Effect.forkChild(scripts.execute(script, { keys: [] }));
    yield* sent(primary, ["EVALSHA", "sha", "0"], missing);
    const load = yield* primary.nextWrite;
    yield* load.accept(load.bytes.length);
    const second = yield* Effect.forkChild(Effect.exit(scripts.execute(script, { keys: [] })));
    yield* sent(secondary, ["EVALSHA", "sha", "0"], missing);
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(first);
    const exit = yield* Fiber.join(second);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.hasInterrupts(exit.cause)).toBe(true);
    expect(yield* secondary.written).toHaveLength(1);
  }),
);

it.effect("SCRIPT: binary keys/arguments are stable through cache-load suspension", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const scripts = yield* makeRedisScripts(sessions);
    const key = bytes("key");
    const arg = bytes("arg");
    const request = yield* Effect.forkChild(scripts.execute(script, { keys: [key], args: [arg] }));
    yield* sent(primary, ["EVALSHA", "sha", "1", bytes("key"), bytes("arg")], missing);
    key.fill(0);
    arg.fill(0);

    yield* sent(primary, ["SCRIPT", "LOAD", "return 1"], "$3\r\nsha\r\n");
    yield* sent(primary, ["EVALSHA", "sha", "1", bytes("key"), bytes("arg")], ":1\r\n");
    expect(yield* Fiber.join(request)).toBe(1n);
  }),
);

it.effect("SCRIPT: uncertain script replies never authorize a second execution", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const scripts = yield* makeRedisScripts(sessions);
    const request = yield* Effect.forkChild(Effect.flip(scripts.execute(script, { keys: [] })));
    yield* sent(primary, ["EVALSHA", "sha", "0"]);
    yield* primary.failRead(new TransportError({ stage: "read", reason: "io" }));

    expect(yield* Fiber.join(request)).toMatchObject({
      _tag: "ConnectionError",
      delivery: "possibly-written",
    });
    expect(yield* primary.written).toHaveLength(1);
  }),
);

it.effect(
  "SCRIPT: rejected loads release coordination without retrying the rejected invocation",
  () =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture();
      const scripts = yield* makeRedisScripts(sessions);
      const first = yield* Effect.forkChild(Effect.flip(scripts.execute(script, { keys: [] })));
      yield* sent(primary, ["EVALSHA", "sha", "0"], missing);
      yield* sent(primary, ["SCRIPT", "LOAD", "return 1"], "-NOPERM load denied\r\n");
      expect(yield* Fiber.join(first)).toMatchObject({ code: "NOPERM" });
      expect(yield* primary.written).toHaveLength(2);

      const next = yield* Effect.forkChild(scripts.execute(script, { keys: [] }));
      yield* sent(primary, ["EVALSHA", "sha", "0"], missing);
      yield* sent(primary, ["SCRIPT", "LOAD", "return 1"], "$3\r\nsha\r\n");
      yield* sent(primary, ["EVALSHA", "sha", "0"], ":1\r\n");
      expect(yield* Fiber.join(next)).toBe(1n);
    }),
);
