import type { Effect } from "effect";

import type { PreparedCommand } from "#/command/Command";
import type { ClusterError } from "#/errors/ClusterError";
import type { SentinelError } from "#/errors/SentinelError";
import type { RedisArgument } from "#/RedisArgument";

/** Optional topology policy; the standalone session retains its original contract. */
export interface SessionValidation {
  readonly command: (
    command: PreparedCommand<unknown, unknown, unknown>,
  ) => Effect.Effect<void, ClusterError | SentinelError>;
  readonly batch: (
    commands: ReadonlyArray<PreparedCommand<unknown, unknown, unknown>>,
    transaction: boolean,
  ) => Effect.Effect<void, ClusterError | SentinelError>;
  readonly watch: (
    keys: ReadonlyArray<RedisArgument>,
  ) => Effect.Effect<void, ClusterError | SentinelError>;
  readonly database: (
    database: bigint | number,
  ) => Effect.Effect<void, ClusterError | SentinelError>;
}
