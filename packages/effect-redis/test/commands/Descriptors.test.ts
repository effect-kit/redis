import { expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Result } from "effect";

import type { CommandDefinition } from "#/command/Command";
import { pingMetadata } from "#/commands/connection/Ping";
import { defineCommand, Reply } from "#/index";
import { commandFixture, respond } from "#test/support/commands/Fixture";

const valid = {
  metadata: pingMetadata,
  tokens: ["PING"],
  routing: { _tag: "Keyless" },
  decode: Reply.status("PONG"),
} satisfies CommandDefinition<void>;
it.effect.each([
  { ...valid, decode: null },
  { ...valid, serverErrors: "ignore" },
  { ...valid, tokens: [] },
  { ...valid, tokens: ["GET", 123] },
  { ...valid, metadata: { ...pingMetadata, replay: "read-only" } },
  { ...valid, metadata: { ...pingMetadata, scenarios: [] } },
  { ...valid, metadata: { ...pingMetadata, provenance: [] } },
  { ...valid, routing: { _tag: "Keys", keys: [{ index: 5, access: "read" }] } },
  { ...valid, routing: { _tag: "Keys", keys: [{ index: 0, access: "read" }] } },
  { ...valid, routing: { _tag: "Keys", keys: [] } },
])(
  "COMMAND-21: invalid descriptor arguments/metadata/keys fail before admission %#",
  (definition) =>
    Effect.gen(function* () {
      const { redis, connection } = yield* commandFixture();
      expect(
        yield* Effect.flip(
          redis.execute(defineCommand(definition as unknown as CommandDefinition<void>)),
        ),
      ).toMatchObject({ _tag: "CommandInputError", delivery: "unsent" });
      expect((yield* connection.snapshot).admitted).toBe(0);
    }),
);
it.effect("COMMAND-22: decoder defects remain defects rather than typed success or retries", () =>
  Effect.gen(function* () {
    const { redis, fixture, connection } = yield* commandFixture();
    const defect = new Error("synthetic decoder defect");
    const command = defineCommand({ ...valid, decode: () => Effect.die(defect) });
    const exit = yield* respond(
      fixture,
      Effect.exit(redis.execute(command)),
      ["PING"],
      "+PONG\r\n",
    );
    expect(Exit.isFailure(exit)).toBe(true);
    yield* respond(fixture, redis.ping(), ["PING"], "+PONG\r\n");
    expect((yield* connection.snapshot).generation).toBe(1);
  }),
);
it.effect(
  "COMMAND-23: codec requirements execute in the calling fiber and cancellation does not fake rollback",
  () =>
    Effect.gen(function* () {
      const { redis, fixture, connection } = yield* commandFixture();
      const command = defineCommand({ ...valid, decode: () => Effect.never });
      const fiber = yield* Effect.forkChild(redis.execute(command));
      const attempt = yield* fixture.nextWrite;
      yield* attempt.accept(attempt.bytes.length);
      yield* fixture.receive(new TextEncoder().encode("+PONG\r\n"));
      while ((yield* connection.snapshot).replies === 0) yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      const result = yield* Effect.result(respond(fixture, redis.ping(), ["PING"], "+PONG\r\n"));
      expect(Result.isSuccess(result)).toBe(true);
      expect((yield* connection.snapshot).unknownOutcomes).toBe(0);
    }),
);
