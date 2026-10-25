import { Effect, Schema } from "effect";

import type { Credentials } from "#/config/Endpoint";
import { decode, NonNegativeInteger, PositiveInteger } from "#/config/Validation";
import type { HandshakeError } from "#/errors/HandshakeError";

const defaulted = (schema: typeof PositiveInteger, value: number) =>
  schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));
const Policy = Schema.Struct({
  reconnectAttempts: defaulted(PositiveInteger.check(Schema.isLessThanOrEqualTo(10)), 3),
  reconnectDelayMillis: defaulted(
    NonNegativeInteger.check(Schema.isLessThanOrEqualTo(60_000)),
    100,
  ),
  shutdownTimeoutMillis: defaulted(PositiveInteger, 5000),
  maxPushMessages: defaulted(PositiveInteger, 64),
  maxPushBytes: defaulted(PositiveInteger, 1024 * 1024),
});
export type ConnectionPolicy = typeof Policy.Type;
export interface ConnectionOptions<R = never> extends Partial<ConnectionPolicy> {
  /** Acquired anew for every physical connection; errors and credentials must be redacted. */
  readonly credentials?: Effect.Effect<typeof Credentials.Type | undefined, HandshakeError, R>;
}
export const decodePolicy = (input: unknown) => decode(Policy, "connection", input);
