import { Effect, Redacted, Schema } from "effect";

import { status } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { Arguments, NonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { Credentials } from "#/config/Endpoint";
import type { RedisArgument } from "#/RedisArgument";
import { exchange } from "#/sessions/controls/Exchange";
import type { SessionWire } from "#/sessions/pool/Wire";
import type { SessionState } from "#/sessions/transaction/State";
import type { SessionValidation } from "#/sessions/Validation";

export const connectionControls = (
  wire: SessionWire,
  state: SessionState,
  taint: () => void,
  validation?: SessionValidation,
) => ({
  authenticate: (credentials: typeof Credentials.Type) =>
    state.run(() =>
      Effect.gen(function* () {
        const identity = yield* parse(Schema.toType(Credentials), credentials);
        taint();

        yield* exchange(
          wire,
          [
            "AUTH",
            ...(identity.username === undefined ? [] : [Redacted.value(identity.username)]),
            Redacted.value(identity.password),
          ],
          status("OK"),
        );
      }),
    ),
  selectDatabase: (database: Integer) =>
    state.run(() =>
      Effect.gen(function* () {
        const selected = yield* parse(NonNegative, database);
        if (validation !== undefined) yield* validation.database(selected);
        taint();

        yield* exchange(wire, ["SELECT", String(selected)], status("OK"));
      }),
    ),
  // No protocol argument: inspect the current connection without replacing its framing contract.
  hello: () => state.run(() => exchange(wire, ["HELLO"], fields)),
  clientCapabilities: (capabilities: readonly [RedisArgument, ...RedisArgument[]]) =>
    state.run(() =>
      Effect.gen(function* () {
        const tokens = yield* parse(Arguments, capabilities);
        taint();
        yield* exchange(wire, ["CLIENT", "CAPA", ...tokens], status("OK"));
      }),
    ),
  importSource: (mode: "ON" | "OFF") =>
    state.run(() =>
      Effect.gen(function* () {
        const selected = yield* parse(Schema.Literals(["ON", "OFF"]), mode);
        taint();
        yield* exchange(wire, ["CLIENT", "IMPORT-SOURCE", selected], status("OK"));
      }),
    ),
  reset: () =>
    state.run(() =>
      Effect.gen(function* () {
        state.set("uncertain");
        yield* exchange(wire, ["RESET"], status("RESET"));
        // RESET clears auth/database/protocol state; a fresh handshake is required before reuse.
        state.set("closed");
        wire.retire();
      }),
    ),
  quit: () =>
    state.run(() =>
      Effect.gen(function* () {
        state.set("uncertain");
        yield* exchange(wire, ["QUIT"], status("OK"));
        state.set("closed");
        wire.retire();
      }),
    ),
});
