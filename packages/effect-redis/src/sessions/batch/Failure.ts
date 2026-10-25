import { Effect } from "effect";

/** Keep evidence attached to interrupted Causes while translating expected errors. */
export const mapBatchFailure = <A, E, E2, R>(
  effect: Effect.Effect<A, E, R>,
  map: (error: E) => E2,
) => Effect.uninterruptibleMask((restore) => restore(effect).pipe(Effect.mapError(map)));
