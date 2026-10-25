import { Effect, Schema } from "effect";

import { decode, PositiveInteger } from "#/config/Validation";
import type { ConnectionOptions } from "#/connection/Options";

const defaulted = (value: number) =>
  PositiveInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));

const Policy = Schema.Struct({
  maxSessionConnections: defaulted(4),
  maxBlockingConnections: defaulted(2),
  maxWaiters: defaulted(128),
  leaseTimeoutMillis: defaulted(5000),
  cleanupTimeoutMillis: defaulted(1000),
  maxBatchCommands: defaulted(256),
});

export type SessionPolicy = typeof Policy.Type;

export interface SessionOptions<R = never> extends Partial<SessionPolicy> {
  readonly connection?: ConnectionOptions<R>;
}

export const decodeSessionPolicy = (options: unknown) => decode(Policy, "sessions", options);
