import type { RespPairs } from "#/protocol/RespValue";

export type Invalidation =
  | {
      readonly _tag: "Invalidate";
      readonly keys: ReadonlyArray<Uint8Array> | null;
      readonly generation: number;
      readonly attributes: RespPairs;
    }
  | { readonly _tag: "TrackingGap"; readonly generation: number }
  | { readonly _tag: "TrackingReady"; readonly generation: number };

/** Only library-owned synchronous cache state is registered here; user Effects run downstream. */
export class InvalidationState {
  revision = 0n;
  readonly caches = new Set<(keys: ReadonlyArray<Uint8Array> | null) => void>();

  invalidate(keys: ReadonlyArray<Uint8Array> | null) {
    this.revision++;
    for (const invalidate of this.caches) invalidate(keys);
  }
}
