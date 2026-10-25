import { expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber } from "effect";

import { Commands } from "#/index";
import { encodeBatch } from "#/protocol/encodeBatch";
import { bytes, sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect(
  "SESSION-WAIT: replication and AOF acknowledgments follow writes on the leased socket",
  () =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture();
      const request = yield* Effect.forkChild(
        sessions.withSession((session) =>
          Effect.gen(function* () {
            yield* session.set("k", "v");
            const replicas = yield* session.waitForReplicas(2, { blockFor: Duration.seconds(1) });
            const fsyncs = yield* session.waitForAof(1, 2, { blockFor: Duration.seconds(1) });
            return { replicas, fsyncs };
          }),
        ),
      );
      yield* sent(primary, ["SET", "k", "v"], "+OK\r\n");
      yield* sent(primary, ["WAIT", "2", "1000"], ":1\r\n");
      yield* sent(primary, ["WAITAOF", "1", "2", "1000"], "*2\r\n:1\r\n:1\r\n");

      expect(yield* Fiber.join(request)).toEqual({ replicas: 1n, fsyncs: [1n, 1n] });
    }),
);

it.effect("SESSION-WAIT: millisecond-only waits reject fractional units without writing", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    expect(
      yield* Effect.flip(
        sessions.withSession((session) =>
          session.waitForReplicas(1, { blockFor: Duration.nanos(1n) }),
        ),
      ),
    ).toMatchObject({ _tag: "CommandInputError", delivery: "unsent" });
    expect(yield* primary.written).toEqual([]);
  }),
);

it.effect("SESSION-ADJACENCY: CLIENT CACHING and its command share exclusive scheduling", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const request = yield* Effect.forkChild(
      sessions.withSession((session) =>
        Effect.gen(function* () {
          yield* session.raw(["CLIENT", "TRACKING", "ON", "OPTIN"], {
            execution: "exclusive",
            routing: { _tag: "Keyless" },
          });
          return yield* session.caching("YES", Commands.get("k"));
        }),
      ),
    );
    yield* sent(primary, ["CLIENT", "TRACKING", "ON", "OPTIN"], "+OK\r\n");
    yield* sent(primary, ["CLIENT", "CACHING", "YES"], "+OK\r\n");
    yield* sent(primary, ["GET", "k"], "$1\r\nv\r\n");
    expect(yield* Fiber.join(request)).toMatchObject({ value: "v" });
    expect(yield* primary.observations).toMatchObject({ closed: 1 });
  }),
);

it.effect.each(["OFF", "SKIP"] as const)("SESSION-REPLY: %s owns only its REPLY ON fence", (mode) =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const command = Commands.incr("k");
    const request = yield* Effect.forkChild(
      sessions.withSession((session) =>
        mode === "OFF" ? session.withoutReplies([command]) : session.skipReply(command),
      ),
    );
    const write = yield* primary.nextWrite;
    expect(write.bytes).toEqual(
      yield* Effect.fromResult(
        encodeBatch(
          [
            ["CLIENT", "REPLY", mode],
            ["INCR", "k"],
            ["CLIENT", "REPLY", "ON"],
          ],
          {},
        ),
      ),
    );
    yield* write.accept(write.bytes.length);
    yield* primary.receive(bytes("+OK\r\n"));
    yield* Fiber.join(request);

    const next = yield* Effect.forkChild(sessions.withSession((session) => session.ping()));
    yield* sent(primary, ["PING"], "+PONG\r\n");
    yield* Fiber.join(next);
  }),
);

it.effect("SESSION-REPLY: rejected suppression cannot leave an uncertain socket reusable", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const request = yield* Effect.forkChild(
      Effect.flip(sessions.withSession((session) => session.withoutReplies([Commands.incr("k")]))),
    );
    const write = yield* primary.nextWrite;
    yield* write.accept(write.bytes.length);
    yield* primary.receive(bytes("-NOPERM private-key\r\n"));
    const failure = yield* Fiber.join(request);
    expect(failure).toMatchObject({ _tag: "BatchError", execution: "partial-or-unknown" });
    expect(JSON.stringify(failure)).not.toContain("private-key");
    expect(yield* primary.observations).toMatchObject({ closed: 1 });
  }),
);

it.effect.each([
  { command: "RESET", reply: "+RESET\r\n", method: "reset" as const },
  { command: "QUIT", reply: "+OK\r\n", method: "quit" as const },
])("SESSION-CONTROL: $command retires before another borrower", ({ command, reply, method }) =>
  Effect.gen(function* () {
    const { sessions, primary, secondary } = yield* sessionFixture();
    const request = yield* Effect.forkChild(sessions.withSession((session) => session[method]()));
    yield* sent(primary, [command], reply);
    yield* Fiber.join(request);
    expect(yield* primary.observations).toMatchObject({ closed: 1 });
    const next = yield* Effect.forkChild(sessions.withSession((session) => session.ping()));
    yield* sent(secondary, ["PING"], "+PONG\r\n");
    yield* Fiber.join(next);
  }),
);

it.effect("SESSION-CONTROL: backend connection flags are isolated to the owning scope", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture();
    const request = yield* Effect.forkChild(
      sessions.withSession((session) =>
        Effect.gen(function* () {
          yield* session.clientCapabilities(["redirect"]);
          yield* session.importSource("ON");
          yield* session.importSource("OFF");
        }),
      ),
    );
    yield* sent(primary, ["CLIENT", "CAPA", "redirect"], "+OK\r\n");
    yield* sent(primary, ["CLIENT", "IMPORT-SOURCE", "ON"], "+OK\r\n");
    yield* sent(primary, ["CLIENT", "IMPORT-SOURCE", "OFF"], "+OK\r\n");
    yield* Fiber.join(request);
    expect(yield* primary.observations).toMatchObject({ closed: 1 });
  }),
);
