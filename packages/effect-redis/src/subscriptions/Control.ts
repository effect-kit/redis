import { Effect } from "effect";

import { checkServerReply } from "#/command/Decode";
import { SubscriptionError } from "#/errors/SubscriptionError";
import type { EventWire } from "#/events/Wire";
import { byteIdentity, eventFrame } from "#/subscriptions/Frames";

export const subscriptionControl = Effect.fnUntraced(function* (
  wire: EventWire,
  kind: string,
  targets: readonly [Uint8Array, ...Uint8Array[]],
) {
  const remaining = new Set(targets.map(byteIdentity));
  const reply = yield* wire.request([kind.toUpperCase(), ...targets], (value, handled) =>
    Effect.gen(function* () {
      yield* checkServerReply(value);
      const frame = yield* eventFrame(value);
      if (frame?._tag !== "Acknowledgment") {
        if (!handled)
          return yield* new SubscriptionError({ reason: "acknowledgment", generation: wire.id });
        return false;
      }

      if (frame.kind !== kind || !remaining.delete(byteIdentity(frame.target)))
        return yield* new SubscriptionError({ reason: "acknowledgment", generation: wire.id });

      return remaining.size === 0;
    }),
  );
  yield* checkServerReply(reply);
});
