import { Effect, Schema } from "effect";

import { status } from "#/command/reply/Scalars";
import { Arguments, parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";
import { exchange } from "#/sessions/controls/Exchange";
import type { SessionWire } from "#/sessions/pool/Wire";
import type { SessionState } from "#/sessions/transaction/State";

export const connectionControls = (wire: SessionWire, state: SessionState, taint: () => void) => ({
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
