import { Effect, Schema } from "effect";

import { tuple } from "#/command/reply/Data";
import { integer } from "#/command/reply/Scalars";
import { blockingTiming } from "#/commands/blocking/Timing";
import type { BlockingOptions } from "#/commands/blocking/Timing";
import { nonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { exchange } from "#/sessions/controls/Exchange";
import type { SessionWire } from "#/sessions/pool/Wire";
import type { SessionState } from "#/sessions/transaction/State";

export const durabilityControls = (wire: SessionWire, state: SessionState) => ({
  waitForReplicas: (replicas: Integer, options: BlockingOptions) =>
    state.run(() =>
      Effect.gen(function* () {
        const count = yield* nonNegative(replicas);
        const timing = yield* blockingTiming(options, "milliseconds");

        return yield* exchange(
          wire,
          ["WAIT", count, timing.token],
          integer,
          timing.replyTimeoutMillis,
        );
      }),
    ),
  waitForAof: (local: 0 | 1, replicas: Integer, options: BlockingOptions) =>
    state.run(() =>
      Effect.gen(function* () {
        const fsync = yield* parse(Schema.Literals([0, 1]), local);
        const count = yield* nonNegative(replicas);
        const timing = yield* blockingTiming(options, "milliseconds");

        return yield* exchange(
          wire,
          ["WAITAOF", String(fsync), count, timing.token],
          tuple(integer, integer),
          timing.replyTimeoutMillis,
        );
      }),
    ),
});
