import type { EventFrame, SubscriptionMode } from "#/subscriptions/Frames";

export type PubSubMessage = Extract<
  EventFrame,
  { readonly _tag: "Message" | "PatternMessage" | "ShardMessage" }
> & {
  readonly generation: number;
};

export type SubscriptionEvent =
  | PubSubMessage
  | { readonly _tag: "DeliveryGap"; readonly generation: number }
  | { readonly _tag: "Ready"; readonly generation: number };

export interface SubscribeOptions {
  readonly mode?: SubscriptionMode;
  /** events exposes gaps; messages fails on a gap rather than hiding lost delivery. */
  readonly recovery?: "fail" | "resubscribe";
}
