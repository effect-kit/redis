import { Effect, Schema } from "effect";

import { defineCommand, fromPreparation } from "#/command/Command";
import type { ReplyDecoder } from "#/command/Command";
import { blockingTiming, BlockingOptionsSchema } from "#/commands/blocking/Timing";
import { keyIndexes } from "#/commands/internal/Command";
import { Argument, parse, Positive, NonNegative } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/streams/Catalog";
import { GroupReadId, ReadId } from "#/commands/streams/Id";
import { claimedEntry, entry, groupEntry, reads } from "#/commands/streams/reply/Entries";
import type { RedisArgument } from "#/RedisArgument";

const common = {
  count: Schema.optionalKey(Positive),
  maxCount: Schema.optionalKey(Positive),
  maxSize: Schema.optionalKey(Positive),
  block: Schema.optionalKey(BlockingOptionsSchema),
};
export const ReadOptionsSchema = Schema.Struct(common);
const GroupOptions = Schema.Struct({ ...common, noAck: Schema.optionalKey(Schema.Boolean) });
export type StreamReadOptions = typeof ReadOptionsSchema.Type;
export type GroupReadOptions = typeof GroupOptions.Type;
export type ReadStreams = readonly [
  readonly [RedisArgument, ReadId],
  ...Array<readonly [RedisArgument, ReadId]>,
];
export type GroupReadStreams = readonly [
  readonly [RedisArgument, GroupReadId],
  ...Array<readonly [RedisArgument, GroupReadId]>,
];
export type BlockingReadOptions = StreamReadOptions & {
  readonly block: NonNullable<StreamReadOptions["block"]>;
};
export type BlockingGroupOptions = GroupReadOptions & {
  readonly block: NonNullable<GroupReadOptions["block"]>;
};

const read = <A>(
  name: "XREAD" | "XREADGROUP",
  streams: ReadStreams | GroupReadStreams,
  options: StreamReadOptions | GroupReadOptions,
  decode: ReplyDecoder<A>,
  group?: RedisArgument,
  consumer?: RedisArgument,
  claim?: Integer,
) =>
  fromPreparation(
    Effect.gen(function* () {
      const grouped = name === "XREADGROUP";
      const selected = yield* parse(GroupOptions, options);
      if (!grouped && selected.noAck !== undefined)
        return yield* parse(Schema.Never, selected.noAck);
      if (
        selected.maxCount !== undefined &&
        selected.count !== undefined &&
        selected.maxCount < selected.count
      )
        return yield* parse(Schema.Never, selected.maxCount);

      const values = yield* parse(
        Schema.NonEmptyArray(Schema.Tuple([Argument, grouped ? GroupReadId : ReadId])),
        streams,
      );
      const timing =
        selected.block === undefined
          ? undefined
          : yield* blockingTiming(selected.block, "milliseconds");
      const prefix: RedisArgument[] = [
        ...(grouped
          ? ["GROUP", yield* parse(Argument, group), yield* parse(Argument, consumer)]
          : []),
        ...(selected.count === undefined ? [] : ["COUNT", String(selected.count)]),
        ...(selected.maxCount === undefined ? [] : ["MAXCOUNT", String(selected.maxCount)]),
        ...(selected.maxSize === undefined ? [] : ["MAXSIZE", String(selected.maxSize)]),
        ...(timing === undefined ? [] : ["BLOCK", timing.token]),
        ...(claim === undefined ? [] : ["CLAIM", String(yield* parse(NonNegative, claim))]),
        ...(selected.noAck ? ["NOACK"] : []),
        "STREAMS",
      ];
      return yield* defineCommand({
        metadata: { ...catalog[name], execution: timing === undefined ? "ordinary" : "blocking" },
        tokens: [name, ...prefix, ...values.map(([key]) => key), ...values.map(([, id]) => id)],
        routing: keyIndexes(
          values.map((_, index) => index + prefix.length + 1),
          grouped ? "read-write" : "read",
        ),
        decode: reads(decode),
        ...(timing === undefined ? {} : { replyTimeoutMillis: timing.replyTimeoutMillis }),
      }).prepare;
    }),
  );

export const xread = (streams: ReadStreams, options: StreamReadOptions = {}) =>
  read("XREAD", streams, options, entry);

export const xreadgroup = (
  group: RedisArgument,
  consumer: RedisArgument,
  streams: GroupReadStreams,
  options: GroupReadOptions = {},
) => read("XREADGROUP", streams, options, groupEntry, group, consumer);

/** CLAIM extends every returned entry with delivery metadata, including newly delivered entries. */
export const xreadgroupClaim = (
  group: RedisArgument,
  consumer: RedisArgument,
  streams: GroupReadStreams,
  minIdleMillis: Integer,
  options: GroupReadOptions = {},
) => read("XREADGROUP", streams, options, claimedEntry, group, consumer, minIdleMillis);
