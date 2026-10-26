import type { Option } from "effect";

import type { StreamId } from "#/commands/streams/Id";
import type { StreamEntry } from "#/commands/streams/Types";
import type { RespValue } from "#/protocol/RespValue";

export interface StreamGroupInfo {
  readonly name: Uint8Array;
  readonly consumers: bigint;
  readonly pending: bigint;
  readonly lastDeliveredId: StreamId;
  readonly entriesRead: Option.Option<bigint>;
  readonly lag: Option.Option<bigint>;
}

export interface StreamConsumerInfo {
  readonly name: Uint8Array;
  readonly pending: bigint;
  readonly idleMillis: bigint;
  readonly inactiveMillis: Option.Option<bigint>;
}

export interface StreamStatistics {
  readonly length: bigint;
  readonly radixTreeKeys: bigint;
  readonly radixTreeNodes: bigint;
  readonly lastGeneratedId: StreamId;
  readonly maxDeletedEntryId: Option.Option<StreamId>;
  readonly recordedFirstEntryId: Option.Option<StreamId>;
  readonly entriesAdded: Option.Option<bigint>;
  readonly idmpDurationSeconds: Option.Option<bigint>;
  readonly idmpMaxSize: Option.Option<bigint>;
  readonly producersTracked: Option.Option<bigint>;
  readonly idempotentIdsTracked: Option.Option<bigint>;
  readonly idempotentIdsAdded: Option.Option<bigint>;
  readonly idempotentDuplicates: Option.Option<bigint>;
  /** Includes version-specific fields without discarding their RESP representation. */
  readonly attributes: ReadonlyArray<readonly [string, RespValue]>;
}

export interface StreamInfo extends StreamStatistics {
  readonly groups: bigint;
  readonly firstEntry: Option.Option<StreamEntry>;
  readonly lastEntry: Option.Option<StreamEntry>;
}

export interface StreamFullPending {
  readonly id: StreamId;
  readonly consumer: Option.Option<Uint8Array>;
  readonly deliveryTimeMillis: bigint;
  readonly deliveries: bigint;
}

export interface StreamFullConsumer {
  readonly name: Uint8Array;
  readonly seenTimeMillis: bigint;
  readonly activeTimeMillis: Option.Option<bigint>;
  readonly pendingCount: bigint;
  readonly pending: ReadonlyArray<readonly [StreamId, bigint, bigint]>;
}

export interface StreamFullGroup {
  readonly name: Uint8Array;
  readonly lastDeliveredId: StreamId;
  readonly entriesRead: Option.Option<bigint>;
  readonly pendingCount: bigint;
  readonly nackedCount: Option.Option<bigint>;
  readonly pending: ReadonlyArray<StreamFullPending>;
  readonly consumers: ReadonlyArray<StreamFullConsumer>;
}

export interface StreamInfoFull extends StreamStatistics {
  readonly entries: ReadonlyArray<StreamEntry>;
  readonly groups: ReadonlyArray<StreamFullGroup>;
}
