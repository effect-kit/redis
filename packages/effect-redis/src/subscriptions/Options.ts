import { Effect, Schema } from "effect";

import { decode, NonNegativeInteger, PositiveInteger } from "#/config/Validation";
import type { ConnectionOptions } from "#/connection/Options";

const defaulted = (value: number) =>
  PositiveInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));

const Policy = Schema.Struct({
  maxListeners: defaulted(128),
  maxInterests: defaulted(1024),
  maxInterestBytes: defaulted(1024 * 1024),
  maxWaiters: defaulted(128),
  maxMessages: defaulted(64),
  maxBytes: defaulted(1024 * 1024),
  maxRetainedBytes: defaulted(16 * 1024 * 1024),
  heartbeatMillis: defaulted(30_000),
  reconnectAttempts: defaulted(3),
  reconnectDelayMillis: NonNegativeInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(100))),
});

export type SubscriptionPolicy = typeof Policy.Type;
export interface SubscriptionOptions<R = never> extends Partial<SubscriptionPolicy> {
  readonly credentials?: ConnectionOptions<R>["credentials"];
}

export const decodeSubscriptionPolicy = (options: unknown) =>
  decode(Policy, "subscriptions", options);
