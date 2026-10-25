import type { Option } from "effect";

import type { StreamId } from "#/commands/streams/Id";

export type StreamFields = ReadonlyArray<readonly [Uint8Array, Uint8Array]>;

export interface StreamEntry {
  readonly id: StreamId;
  readonly fields: StreamFields;
}

export interface GroupEntry {
  readonly id: StreamId;
  /** A pending entry can outlive its deleted/trimmed payload. */
  readonly fields: Option.Option<StreamFields>;
}

export interface ClaimedGroupEntry extends GroupEntry {
  readonly idleMillis: bigint;
  readonly deliveries: bigint;
}

export interface StreamRead<A = StreamEntry> {
  readonly key: Uint8Array;
  readonly entries: ReadonlyArray<A>;
}

export interface PendingEntry {
  readonly id: StreamId;
  readonly consumer: Uint8Array;
  readonly idleMillis: bigint;
  readonly deliveries: bigint;
}

export interface PendingSummary {
  readonly count: bigint;
  readonly smallest: Option.Option<StreamId>;
  readonly largest: Option.Option<StreamId>;
  readonly consumers: ReadonlyArray<readonly [Uint8Array, bigint]>;
}

export interface ClaimPage<A = Option.Option<GroupEntry>> {
  readonly cursor: StreamId;
  /** Legacy null entries carry no ID; None preserves that missing evidence without fabrication. */
  readonly entries: ReadonlyArray<A>;
  /** None is the older two-element reply, not evidence that no IDs were deleted. */
  readonly deleted: Option.Option<ReadonlyArray<StreamId>>;
}
