import { Effect, Schema } from "effect";

import type { SentinelAddress } from "#/commands/sentinel/Discovery";
import { TlsOptions } from "#/config/Endpoint";
import { decode, NonNegativeInteger, PositiveInteger } from "#/config/Validation";
import type { ConnectionOptions } from "#/connection/Options";
import type { SessionOptions } from "#/sessions/pool/Options";

const defaulted = (value: number) =>
  PositiveInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));
const Policy = Schema.Struct({
  maxSentinels: defaulted(16),
  maxDataNodes: defaulted(16),
  maxOperations: defaulted(1024),
  maxEventCohorts: defaulted(64),
  discoveryTimeoutMillis: defaulted(5000),
  sentinelTimeoutMillis: defaulted(500),
  operationTimeoutMillis: defaulted(30_000),
  refreshIntervalMillis: defaulted(30_000),
  discoveryAttempts: PositiveInteger.check(Schema.isLessThanOrEqualTo(10)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(3)),
  ),
  retryDelayMillis: NonNegativeInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(100))),
  learnSentinels: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  readPreference: Schema.Literals(["primary", "replica-preferred"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("primary")),
  ),
  dataTls: Schema.optionalKey(TlsOptions),
});

export interface SentinelOptions<R = never> extends Partial<typeof Policy.Type> {
  readonly sentinelConnection?: ConnectionOptions<R>;
  readonly connection?: ConnectionOptions<R>;
  readonly sessions?: Omit<SessionOptions<R>, "connection">;
  readonly addressMap?: (
    address: SentinelAddress,
    plane: "sentinel" | "data",
  ) => SentinelAddress & { readonly serverName?: string };
}

export const decodeSentinelPolicy = (input: unknown) => decode(Policy, "sentinel", input);
export type SentinelPolicy = typeof Policy.Type;
