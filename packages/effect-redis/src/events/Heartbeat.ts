import { Effect } from "effect";

import { checkServerReply } from "#/command/Decode";
import { status } from "#/command/reply/Scalars";
import type { EventWire } from "#/events/Wire";
import { eventFrame } from "#/subscriptions/Frames";

/** RESP2 subscriptions acknowledge PING as an array; ordinary/RESP3 connections use PONG. */
export const pingEventWire = Effect.fnUntraced(function* (wire: EventWire) {
  const reply = yield* wire.request(["PING"], (value, handled) =>
    eventFrame(value).pipe(Effect.map((frame) => frame?._tag === "Pong" || !handled)),
  );
  yield* checkServerReply(reply);
  const frame = yield* eventFrame(reply);
  if (frame?._tag !== "Pong") yield* status("PONG")(reply);
});
