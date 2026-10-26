import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { RedisCommand } from "#/index";
import { controlled } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

const protocols: ReadonlyArray<RedisCommand> = [
  ["SCRIPT", "DEBUG", "YES"],
  ["SCRIPT", "DEBUG", "SYNC"],
  ["PSYNC", "?", "-1"],
  ["SYNC"],
  ["REPLCONF", "listening-port", "6379"],
];

it.effect.each(protocols)("MODE: %j cannot switch the shared request/reply protocol", (tokens) =>
  Effect.gen(function* () {
    const { connection, fixture } = yield* controlled();
    expect(yield* Effect.flip(connection.executeOrdinary(tokens))).toMatchObject({
      _tag: "AdmissionError",
      reason: "session-required",
      delivery: "unsent",
    });
    expect(yield* fixture.written).toHaveLength(0);

    const { sessions, primary } = yield* sessionFixture();
    expect(
      yield* Effect.flip(
        sessions.withSession((session) =>
          session.raw(tokens, { execution: "advanced", routing: { _tag: "Keyless" } }),
        ),
      ),
    ).toMatchObject({ _tag: "SessionError", reason: "execution-mode", delivery: "unsent" });
    expect(yield* primary.written).toHaveLength(0);
  }),
);

it.effect("HIMPORT: physical fieldsets cannot be armed on an ordinary shared connection", () =>
  Effect.gen(function* () {
    const { connection, fixture } = yield* controlled();
    expect(
      yield* Effect.flip(connection.executeOrdinary(["HIMPORT", "PREPARE", "fs", "f"])),
    ).toMatchObject({ reason: "session-required", delivery: "unsent" });
    expect(yield* fixture.written).toHaveLength(0);
  }),
);
