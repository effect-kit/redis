import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Redacted } from "effect";

import { BatchError, Commands, defineCommand, makeRedisSessions } from "#/index";
import { Transport } from "#/transport/Transport";
import { sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect("SESSION-DEFECT: decoder defects retain received evidence and retire the lease", () =>
  Effect.gen(function* () {
    const { sessions, primary, secondary } = yield* sessionFixture();
    const original = yield* Commands.incr("k").prepare;
    const command = defineCommand({
      ...original,
      decode: () => Effect.die("synthetic-decoder-defect"),
    });
    const request = yield* Effect.forkChild(Effect.exit(sessions.pipeline([command])));
    yield* sent(primary, ["INCR", "k"], ":1\r\n");

    const exit = yield* Fiber.join(request);
    expect(Exit.hasDies(exit)).toBe(true);
    if (exit._tag !== "Failure") return yield* Effect.die("Expected decoder defect");
    expect(Cause.findDefect(exit.cause)).toMatchObject({ success: "synthetic-decoder-defect" });
    // Effect converts finalizer failures to defects when the original Cause contains a defect.
    const evidence = exit.cause.reasons
      .filter(Cause.isDieReason)
      .map((reason) => reason.defect)
      .find((defect) => defect instanceof BatchError);
    expect(evidence).toMatchObject({ execution: "replied" });
    if (!(evidence instanceof BatchError)) return yield* Effect.die("Missing received evidence");
    expect(Redacted.value(evidence.outcomes)).toMatchObject([{ _tag: "Replied", index: 0 }]);
    expect(yield* primary.observations).toMatchObject({ closed: 1 });

    const next = yield* Effect.forkChild(sessions.withSession((session) => session.ping()));
    yield* sent(secondary, ["PING"], "+PONG\r\n");
    yield* Fiber.join(next);
  }),
);

it.effect("SESSION-DEFECT: failed physical cleanup prevents replacement acquisition", () =>
  Effect.gen(function* () {
    const { config, layer, primary, opens } = yield* sessionFixture();
    const transport = yield* Transport.pipe(Effect.provide(layer));
    const scoped = yield* Effect.exit(
      Effect.scoped(
        Effect.gen(function* () {
          const sessions = yield* makeRedisSessions(config).pipe(
            Effect.provideService(Transport, {
              open: (input) =>
                Effect.gen(function* () {
                  const physical = yield* transport.open(input);
                  yield* Effect.addFinalizer(() => Effect.die("synthetic-cleanup-defect"));
                  return physical;
                }),
            }),
          );
          const request = yield* Effect.forkChild(
            Effect.exit(sessions.withSession((session) => session.ping())),
          );
          yield* sent(primary, ["PING"]);
          yield* primary.end;
          expect(Exit.hasDies(yield* Fiber.join(request))).toBe(true);
          const future = yield* Effect.exit(sessions.withSession((s) => s.ping()));
          expect(Exit.hasDies(future)).toBe(true);
          expect(opens()).toBe(1);
          if (future._tag === "Failure") return yield* Effect.failCause(future.cause);
        }),
      ),
    );

    expect(Exit.hasDies(scoped)).toBe(true);
    expect(yield* primary.observations).toMatchObject({ closed: 1 });
  }),
);
