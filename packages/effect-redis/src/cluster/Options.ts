import { Effect, Schema } from "effect";

import type { ClusterAddress } from "#/cluster/topology/Types";
import { decode, PositiveInteger } from "#/config/Validation";
import type { ConnectionOptions } from "#/connection/Options";
import type { SessionOptions } from "#/sessions/pool/Options";

const defaulted = (value: number) =>
  PositiveInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));
const Policy = Schema.Struct({
  maxNodes: defaulted(64),
  maxRedirects: defaulted(8),
  maxOperations: defaulted(1024),
  maxRetainedBytes: defaulted(16 * 1024 * 1024),
  operationTimeoutMillis: defaulted(30_000),
  refreshIntervalMillis: defaulted(30_000),
  discovery: Schema.Literals(["auto", "shards", "slots"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("auto")),
  ),
  readPreference: Schema.Literals(["primary", "replica-preferred"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("primary")),
  ),
  databaseCapability: Schema.Literals(["db0", "valkey-multi-db"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("db0")),
  ),
});

export interface ClusterOptions<R = never> extends Partial<typeof Policy.Type> {
  readonly seeds?: ReadonlyArray<ClusterAddress>;
  /** Dial translation does not change TLS identity unless serverName is explicitly supplied. */
  readonly addressMap?: (
    address: ClusterAddress,
  ) => ClusterAddress & { readonly serverName?: string };
  readonly connection?: ConnectionOptions<R>;
  readonly sessions?: Omit<SessionOptions<R>, "connection">;
}

export const decodeClusterPolicy = (input: unknown) => decode(Policy, "cluster", input);
export type ClusterPolicy = typeof Policy.Type;
