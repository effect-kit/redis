import type { Mailbox } from "#/events/Mailbox";
import { byteIdentity, sameBytes } from "#/subscriptions/Frames";
import type { EventFrame, SubscriptionMode } from "#/subscriptions/Frames";
import type { SubscribeOptions, SubscriptionEvent } from "#/subscriptions/Types";

export interface Interest {
  readonly mode: SubscriptionMode;
  readonly target: Uint8Array;
  readonly listeners: Set<Listener>;
  active: boolean;
}

export interface Listener {
  readonly mode: SubscriptionMode;
  targets: ReadonlyArray<Uint8Array>;
  readonly recovery: NonNullable<SubscribeOptions["recovery"]>;
  readonly mailbox: Mailbox<SubscriptionEvent>;
  ready: boolean;
  closed: boolean;
}

export const interestId = (mode: SubscriptionMode, target: Uint8Array) =>
  `${mode}:${byteIdentity(target)}`;

export const messageMatches = (interest: Interest, frame: EventFrame) => {
  if (frame._tag === "PatternMessage")
    return interest.mode === "pattern" && sameBytes(interest.target, frame.pattern);
  if (frame._tag === "Message" || frame._tag === "ShardMessage")
    return (
      interest.mode === (frame._tag === "Message" ? "channel" : "shard") &&
      sameBytes(interest.target, frame.channel)
    );
  return false;
};

export const copyMessage = (
  frame: Extract<EventFrame, { _tag: "Message" | "PatternMessage" | "ShardMessage" }>,
  generation: number,
) => ({
  ...frame,
  channel: frame.channel.slice(),
  payload: frame.payload.slice(),
  ...(frame._tag === "PatternMessage" ? { pattern: frame.pattern.slice() } : {}),
  generation,
});
