import type { Effect } from "effect";

import type { RedisError } from "#/command/Executor";
import type { RedisSession } from "#/sessions/Session";

/** Bound session access shared by standalone and explicitly targeted topology services. */
export interface SessionAccess {
  readonly withSession: <A, E, R>(
    body: (session: RedisSession) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RedisError, R>;
  readonly withBlockingSession: <A, E, R>(
    body: (session: RedisSession) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RedisError, R>;
}
