import { Effect, Schema } from "effect";

import type { Command } from "#/command/Command";
import { decodeReply } from "#/command/Decode";
import { status } from "#/command/reply/Scalars";
import { parse } from "#/commands/internal/Input";
import { validateOrdinary } from "#/sessions/batch/Prepare";
import { exchange } from "#/sessions/controls/Exchange";
import type { SessionWire } from "#/sessions/pool/Wire";
import type { SessionState } from "#/sessions/transaction/State";
import type { SessionValidation } from "#/sessions/Validation";

export const adjacencyControls = (
  wire: SessionWire,
  state: SessionState,
  validation?: SessionValidation,
) => ({
  caching: <A, E, RD, RE>(mode: "YES" | "NO", command: Command<A, E, RD, RE>) =>
    state.run(() =>
      Effect.gen(function* () {
        const selected = yield* parse(Schema.Literals(["YES", "NO"]), mode);
        const prepared = yield* command.prepare;
        yield* validateOrdinary(prepared);
        if (validation !== undefined) yield* validation.command(prepared);
        const before = state.get();

        // Until the following reply arrives, an armed next-command flag must never escape this lease.
        state.set("uncertain");
        yield* exchange(wire, ["CLIENT", "CACHING", selected], status("OK"));
        const reply = yield* wire.execute(prepared.tokens);
        state.set(before);

        return yield* decodeReply(prepared, reply);
      }),
    ),
});
