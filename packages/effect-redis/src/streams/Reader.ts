import { Duration, Effect, Option, Queue, Schema, Stream } from "effect";

import type { RedisError } from "#/command/Executor";
import { Arguments, Argument, parse } from "#/commands/internal/Input";
import { StreamPosition, compareIds } from "#/commands/streams/Id";
import type { StreamId } from "#/commands/streams/Id";
import { ReadOptionsSchema } from "#/commands/streams/Read";
import type { StreamReadOptions } from "#/commands/streams/Read";
import type { GroupEntry } from "#/commands/streams/Types";
import { StreamConsumerError } from "#/errors/StreamConsumerError";
import type { RedisArgument } from "#/RedisArgument";
import type { SessionAccess } from "#/sessions/Access";
import { argumentBytes, equalBytes } from "#/streams/internal/Argument";
import { scopedReader } from "#/streams/internal/ScopedReader";
import type { StreamMessage } from "#/streams/Types";

const ContinuousId = Schema.Union([StreamPosition, Schema.Literal("$")]);
const Sources = Schema.NonEmptyArray(Schema.Tuple([Argument, ContinuousId]));
export type ContinuousReadStreams = typeof Sources.Type;
export type ReaderOptions = StreamReadOptions;
export type GroupReaderKeys = readonly [RedisArgument, ...RedisArgument[]];

const readerOptions = (options: ReaderOptions) =>
  parse(ReadOptionsSchema, options).pipe(
    Effect.map((selected) => ({
      ...selected,
      count:
        selected.count ??
        (selected.maxCount !== undefined && selected.maxCount < 64 ? selected.maxCount : 64),
      block: selected.block ?? { blockFor: Duration.seconds(5) },
    })),
  );

export const makeReaders = (sessions: Pick<SessionAccess, "withBlockingSession">) => ({
  read: (streams: ContinuousReadStreams, options: ReaderOptions = {}) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const sources = yield* parse(Sources, streams);
        const selected = yield* readerOptions(options);

        return scopedReader<StreamMessage, RedisError | StreamConsumerError>((queue) =>
          sessions.withBlockingSession((session) =>
            Effect.gen(function* () {
              const positions: Array<readonly [RedisArgument, StreamPosition]> = [];
              const keys = sources.map(([key]) => argumentBytes(key));
              for (const [key, id] of sources) {
                // Snapshot the existing tail once; repeated `$` reads can skip arrivals between requests.
                const position =
                  id === "$"
                    ? ((yield* session.xrevrange(key, "+", "-", { count: 1 }))[0]?.id ?? "0-0")
                    : id;
                positions.push([key, position]);
              }

              const [first, ...rest] = positions;
              if (first === undefined) return yield* Effect.die("Missing validated stream source");
              const cursors = [first, ...rest];

              while (true) {
                const [current, ...remaining] = cursors;
                if (current === undefined) return yield* Effect.die("Missing stream cursor");
                const result = yield* session.xreadBlocking([current, ...remaining], selected);
                for (const batch of Option.getOrElse(result, () => [])) {
                  const index = keys.findIndex((key) => equalBytes(key, batch.key));
                  if (index < 0)
                    return yield* new StreamConsumerError({ reason: "invalid-response" });
                  for (const entry of batch.entries) {
                    const previous = cursors[index]?.[1];
                    // The server treats an incomplete ID as sequence zero.
                    if (
                      previous !== undefined &&
                      compareIds(
                        entry.id,
                        (previous.includes("-") ? previous : `${previous}-0`) as StreamId,
                      ) <= 0n
                    )
                      return yield* new StreamConsumerError({ reason: "invalid-response" });
                    const source = cursors[index];
                    if (source === undefined) return yield* Effect.die("Missing stream cursor");
                    cursors[index] = [source[0], entry.id];

                    yield* Queue.offer(queue, { stream: batch.key, entry });
                  }
                }
              }
            }),
          ),
        );
      }),
    ),

  readGroup: (
    group: RedisArgument,
    consumer: RedisArgument,
    keys: GroupReaderKeys,
    options: ReaderOptions = {},
  ) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const selectedKeys = yield* parse(Arguments, keys);
        const identity = yield* Effect.all([parse(Argument, group), parse(Argument, consumer)]);
        const selected = yield* readerOptions(options);
        const [first, ...rest] = selectedKeys.map((key) => [key, ">"] as const);
        if (first === undefined) return yield* Effect.die("Missing validated group source");
        const streams = [first, ...rest] as const;
        const expected = selectedKeys.map(argumentBytes);

        return scopedReader<StreamMessage<GroupEntry>, RedisError | StreamConsumerError>((queue) =>
          sessions.withBlockingSession((session) =>
            Effect.gen(function* () {
              while (true) {
                const result = yield* session.xreadgroupBlocking(
                  identity[0],
                  identity[1],
                  streams,
                  selected,
                );
                for (const batch of Option.getOrElse(result, () => [])) {
                  if (!expected.some((key) => equalBytes(key, batch.key)))
                    return yield* new StreamConsumerError({ reason: "invalid-response" });
                  for (const entry of batch.entries)
                    yield* Queue.offer(queue, { stream: batch.key, entry });
                }
              }
            }),
          ),
        );
      }),
    ),
});
