import type { Effect, Scope } from "effect";
import { Context } from "effect";

import type { TransportError } from "#/errors/TransportError";
import type { RedisConfig } from "#/RedisConfig";

/** One scoped physical byte connection. Exactly one reader/writer owns each direction. */
export interface TransportConnection {
  /** undefined is clean EOF; chunks are nonempty and owned by the receiver. */
  readonly read: Effect.Effect<Uint8Array | undefined, TransportError>;
  /** Completes after accepting all bytes with backpressure. Failure can follow a partial write. */
  readonly write: (bytes: Uint8Array) => Effect.Effect<void, TransportError>;
  /** Idempotent close wakes pending operations; acquisition also registers scoped cleanup. */
  readonly close: Effect.Effect<void, TransportError>;
}

export class Transport extends Context.Service<
  Transport,
  {
    readonly open: (
      config: RedisConfig,
    ) => Effect.Effect<TransportConnection, TransportError, Scope.Scope>;
  }
>()("effect-redis/transport/Transport") {}
