import type { Option } from "effect";

import { byteIdentity } from "#/subscriptions/Frames";

export interface CachedBytes {
  readonly bytes: Option.Option<Uint8Array>;
  readonly expiresAt: number;
  readonly cost: number;
}

/** Stores only raw GET bytes. Every codec decodes anew, avoiding decoded-value identity sharing. */
export class CacheState {
  readonly entries = new Map<string, CachedBytes>();
  bytes = 0;

  constructor(
    readonly maxEntries: number,
    readonly maxBytes: number,
  ) {}

  remove(identity: string) {
    const entry = this.entries.get(identity);
    if (entry !== undefined) this.bytes -= entry.cost;
    this.entries.delete(identity);
  }

  invalidate(keys: ReadonlyArray<Uint8Array> | null) {
    if (keys === null) {
      this.entries.clear();
      this.bytes = 0;
      return;
    }

    for (const key of keys) this.remove(byteIdentity(key));
  }

  get(identity: string, now: number) {
    const entry = this.entries.get(identity);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now) {
      this.remove(identity);
      return undefined;
    }

    this.entries.delete(identity);
    this.entries.set(identity, entry);
    return entry;
  }

  put(identity: string, entry: CachedBytes) {
    this.remove(identity);
    if (entry.cost > this.maxBytes) return;

    while (this.entries.size >= this.maxEntries || this.bytes + entry.cost > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.remove(oldest.value);
    }

    this.entries.set(identity, entry);
    this.bytes += entry.cost;
  }
}
