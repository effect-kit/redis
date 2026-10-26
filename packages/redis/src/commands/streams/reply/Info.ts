import { Effect } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { nullable, triple, unsigned } from "#/command/reply/Data";
import { blob, integer } from "#/command/reply/Scalars";
import { streamId } from "#/commands/streams/Id";
import type {
  StreamConsumerInfo,
  StreamFullConsumer,
  StreamFullGroup,
  StreamFullPending,
  StreamGroupInfo,
  StreamInfo,
  StreamInfoFull,
  StreamStatistics,
} from "#/commands/streams/InfoTypes";
import { entry } from "#/commands/streams/reply/Entries";
import { record } from "#/commands/streams/reply/Record";
import { at, elements } from "#/commands/streams/reply/Structure";

export const groupInfo: ReplyDecoder<StreamGroupInfo> = (reply) =>
  Effect.gen(function* () {
    const { read, optional } = yield* record(reply);
    return {
      name: yield* read("name", blob),
      consumers: yield* read("consumers", unsigned),
      pending: yield* read("pending", unsigned),
      lastDeliveredId: yield* read("last-delivered-id", streamId),
      entriesRead: yield* optional("entries-read", unsigned),
      lag: yield* optional("lag", unsigned),
    };
  });

export const consumerInfo: ReplyDecoder<StreamConsumerInfo> = (reply) =>
  Effect.gen(function* () {
    const { read, optional } = yield* record(reply);
    return {
      name: yield* read("name", blob),
      pending: yield* read("pending", unsigned),
      idleMillis: yield* read("idle", unsigned),
      inactiveMillis: yield* optional("inactive", integer),
    };
  });

const statistics: ReplyDecoder<StreamStatistics> = (reply) =>
  Effect.gen(function* () {
    const { attributes, read, optional } = yield* record(reply);
    return {
      attributes,
      length: yield* read("length", unsigned),
      radixTreeKeys: yield* read("radix-tree-keys", unsigned),
      radixTreeNodes: yield* read("radix-tree-nodes", unsigned),
      lastGeneratedId: yield* read("last-generated-id", streamId),
      maxDeletedEntryId: yield* optional("max-deleted-entry-id", streamId),
      recordedFirstEntryId: yield* optional("recorded-first-entry-id", streamId),
      entriesAdded: yield* optional("entries-added", unsigned),
      idmpDurationSeconds: yield* optional("idmp-duration", unsigned),
      idmpMaxSize: yield* optional("idmp-maxsize", unsigned),
      producersTracked: yield* optional("pids-tracked", unsigned),
      idempotentIdsTracked: yield* optional("iids-tracked", unsigned),
      idempotentIdsAdded: yield* optional("iids-added", unsigned),
      idempotentDuplicates: yield* optional("iids-duplicates", unsigned),
    };
  });

export const streamInfo: ReplyDecoder<StreamInfo> = (reply) =>
  Effect.gen(function* () {
    const stats = yield* statistics(reply);
    const { read } = yield* record(reply);
    return {
      ...stats,
      groups: yield* read("groups", unsigned),
      firstEntry: yield* read("first-entry", nullable(entry)),
      lastEntry: yield* read("last-entry", nullable(entry)),
    };
  });

const fullPending: ReplyDecoder<StreamFullPending> = (reply) =>
  Effect.gen(function* () {
    const values = yield* elements(reply, 4);
    return {
      id: yield* at(values, 0, streamId),
      consumer: yield* at(values, 1, nullable(blob)),
      deliveryTimeMillis: yield* at(values, 2, unsigned),
      deliveries: yield* at(values, 3, unsigned),
    };
  });

const fullConsumer: ReplyDecoder<StreamFullConsumer> = (reply) =>
  Effect.gen(function* () {
    const { read, optional } = yield* record(reply);
    return {
      name: yield* read("name", blob),
      seenTimeMillis: yield* read("seen-time", unsigned),
      activeTimeMillis: yield* optional("active-time", integer),
      pendingCount: yield* read("pel-count", unsigned),
      pending: yield* read("pending", array(triple(streamId, unsigned, unsigned))),
    };
  });

const fullGroup: ReplyDecoder<StreamFullGroup> = (reply) =>
  Effect.gen(function* () {
    const { read, optional } = yield* record(reply);
    return {
      name: yield* read("name", blob),
      lastDeliveredId: yield* read("last-delivered-id", streamId),
      entriesRead: yield* optional("entries-read", unsigned),
      pendingCount: yield* read("pel-count", unsigned),
      nackedCount: yield* optional("nacked-count", unsigned),
      pending: yield* read("pending", array(fullPending)),
      consumers: yield* read("consumers", array(fullConsumer)),
    };
  });

export const streamInfoFull: ReplyDecoder<StreamInfoFull> = (reply) =>
  Effect.gen(function* () {
    const stats = yield* statistics(reply);
    const { read } = yield* record(reply);
    return {
      ...stats,
      entries: yield* read("entries", array(entry)),
      groups: yield* read("groups", array(fullGroup)),
    };
  });
