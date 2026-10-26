import { Effect, Option, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { nullable, tuple, unsigned } from "#/command/reply/Data";
import { blob, mismatch } from "#/command/reply/Scalars";
import { keyed } from "#/commands/internal/Command";
import { Argument, parse, Positive, NonNegative } from "#/commands/internal/Input";
import { catalog } from "#/commands/streams/Catalog";
import { StreamBound, streamId } from "#/commands/streams/Id";
import { at, elements } from "#/commands/streams/reply/Structure";
import type { PendingEntry, PendingSummary } from "#/commands/streams/Types";
import type { RedisArgument } from "#/RedisArgument";

export const pendingEntry: ReplyDecoder<PendingEntry> = (reply) =>
  Effect.gen(function* () {
    const values = yield* elements(reply, 4);
    return {
      id: yield* at(values, 0, streamId),
      consumer: yield* at(values, 1, blob),
      idleMillis: yield* at(values, 2, unsigned),
      deliveries: yield* at(values, 3, unsigned),
    };
  });

const summary: ReplyDecoder<PendingSummary> = (reply) =>
  Effect.gen(function* () {
    const values = yield* elements(reply, 4);
    const count = yield* at(values, 0, unsigned);
    const smallest = yield* at(values, 1, nullable(streamId));
    const largest = yield* at(values, 2, nullable(streamId));
    const consumers = yield* at(values, 3, nullable(array(tuple(blob, unsigned))));
    if (
      count === 0n
        ? Option.isSome(smallest) || Option.isSome(largest)
        : Option.isNone(smallest) || Option.isNone(largest)
    )
      return yield* mismatch("custom", reply);
    return { count, smallest, largest, consumers: Option.getOrElse(consumers, () => []) };
  });

export const xpending = (key: RedisArgument, group: RedisArgument) =>
  keyed(catalog.XPENDING, key, parse(Argument, group).pipe(Effect.map((name) => [name])), summary);

const PendingOptions = Schema.Struct({
  start: StreamBound,
  end: StreamBound,
  count: Positive,
  idleMillis: Schema.optionalKey(NonNegative),
  consumer: Schema.optionalKey(Argument),
});
export type PendingOptions = typeof PendingOptions.Type;

export const xpendingEntries = (
  key: RedisArgument,
  group: RedisArgument,
  options: PendingOptions,
) =>
  keyed(
    catalog.XPENDING,
    key,
    Effect.gen(function* () {
      const selected = yield* parse(PendingOptions, options);
      return [
        yield* parse(Argument, group),
        ...(selected.idleMillis === undefined ? [] : ["IDLE", String(selected.idleMillis)]),
        selected.start,
        selected.end,
        String(selected.count),
        ...(selected.consumer === undefined ? [] : [selected.consumer]),
      ];
    }),
    array(pendingEntry),
  );
