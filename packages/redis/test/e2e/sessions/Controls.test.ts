import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Commands } from "#/index";
import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { exchange } from "#test/support/networking/Exchange";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "SESSION-CONTROLS: $target.fixture $protocol suppression, adjacency and flags",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { sessions, oracle, prefix } = yield* sessionBackend(target, protocol);
      const key = `${prefix}:count`;

      yield* sessions.withSession((session) =>
        Effect.gen(function* () {
          yield* session.withoutReplies([Commands.incr(key), Commands.incr(key)]);
          yield* session.skipReply(Commands.incr(key));
          expect(yield* session.get(key)).toEqual(Option.some("3"));
          yield* session.raw(["CLIENT", "TRACKING", "ON", "OPTIN"], {
            execution: "exclusive",
            routing: { _tag: "Keyless" },
          });
          expect(yield* session.caching("YES", Commands.get(key))).toEqual(Option.some("3"));
        }),
      );
      expect(yield* exchange(oracle, ["GET", key])).toEqual({
        _tag: "BlobString",
        value: bytes("3"),
      });

      if (target.product === "valkey" && atLeast(target.version, "8.0.0"))
        yield* sessions.withSession((session) => session.clientCapabilities(["redirect"]));
      else
        expect(
          yield* Effect.flip(
            sessions.withSession((session) => session.clientCapabilities(["redirect"])),
          ),
        ).toMatchObject({ _tag: "ServerError" });

      if (target.product === "valkey" && atLeast(target.version, "8.1.0")) {
        yield* sessions.withSession((session) => session.importSource("OFF"));
        expect(
          yield* Effect.flip(sessions.withSession((session) => session.importSource("ON"))),
        ).toMatchObject({ _tag: "ServerError" });
      } else
        expect(
          yield* Effect.flip(sessions.withSession((session) => session.importSource("OFF"))),
        ).toMatchObject({ _tag: "ServerError" });

      yield* sessions.withSession((session) => session.reset());
      yield* sessions.withSession((session) => session.ping());
      yield* sessions.withSession((session) => session.quit());
      yield* sessions.withSession((session) => session.ping());
    }),
);

for (const { target, protocol } of primaryCases.filter(
  (entry) => entry.target.fixture === "valkey",
)) {
  it.live(
    `SESSION-IMPORT: ${target.fixture} ${protocol} owns its import-source configuration`,
    () =>
      Effect.gen(function* () {
        const { sessions, prefix } = yield* sessionBackend(target, protocol, ["import-mode yes"]);
        yield* sessions.withSession((session) =>
          Effect.gen(function* () {
            yield* session.importSource("ON");
            yield* session.set(`${prefix}:import`, "value");
            expect(yield* session.get(`${prefix}:import`)).toEqual(Option.some("value"));
            yield* session.importSource("OFF");
          }),
        );
      }),
  );
}
