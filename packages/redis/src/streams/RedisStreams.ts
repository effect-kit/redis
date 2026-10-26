import { Context, Effect, Layer, Stream } from "effect";

import type { RedisError } from "#/command/Executor";
import { Argument, Arguments, parse } from "#/commands/internal/Input";
import { ReadOptionsSchema } from "#/commands/streams/Read";
import type { StreamConsumerError } from "#/errors/StreamConsumerError";
import { Redis } from "#/Redis";
import type { RedisClient } from "#/Redis";
import type { RedisArgument } from "#/RedisArgument";
import type { SessionAccess } from "#/sessions/Access";
import { RedisSessions } from "#/sessions/RedisSessions";
import { processMessages } from "#/streams/Processing";
import type { ProcessingOptions } from "#/streams/Processing";
import { makeReaders } from "#/streams/Reader";
import type { GroupReaderKeys, ReaderOptions } from "#/streams/Reader";
import { makeRecovery } from "#/streams/Recovery";
import type { GroupMessage, ProcessingOutcome } from "#/streams/Types";

export const makeRedisStreams = (
  redis: RedisClient,
  sessions: Pick<SessionAccess, "withBlockingSession">,
) => {
  const readers = makeReaders(sessions);
  const recovery = makeRecovery(redis);
  return {
    ...readers,
    ...recovery,
    process: <A, E, R, ES, RS, EP = never, RP = never>(
      group: RedisArgument,
      source: Stream.Stream<GroupMessage, ES, RS>,
      handle: (message: GroupMessage) => Effect.Effect<A, E, R>,
      options?: ProcessingOptions<E, EP, RP>,
    ) => processMessages(redis, group, source, handle, options),
    /** Drain this consumer's pending history before requesting new group deliveries. */
    consume: <A, E, R, EP = never, RP = never>(
      group: RedisArgument,
      consumer: RedisArgument,
      keys: GroupReaderKeys,
      handle: (message: GroupMessage) => Effect.Effect<A, E, R>,
      options: ProcessingOptions<E, EP, RP> = {},
      readOptions: ReaderOptions = {},
    ): Stream.Stream<
      ProcessingOutcome<A, E | StreamConsumerError>,
      RedisError | StreamConsumerError | E | EP,
      R | RP
    > =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Validate the complete reader policy before processing or acknowledging pending entries.
          const selectedKeys = yield* parse(Arguments, keys);
          const selected = yield* parse(ReadOptionsSchema, readOptions);
          const identity = yield* Effect.all([parse(Argument, group), parse(Argument, consumer)]);
          const historyOptions = {
            ...(selected.count === undefined ? {} : { count: selected.count }),
            ...(selected.maxCount === undefined ? {} : { maxCount: selected.maxCount }),
            ...(selected.maxSize === undefined ? {} : { maxSize: selected.maxSize }),
          };
          const pending = Stream.fromIterable(selectedKeys).pipe(
            Stream.flatMap((key) =>
              recovery.pending(key, identity[0], identity[1], historyOptions),
            ),
          );
          const history = processMessages(redis, identity[0], pending, handle, options);
          const incoming = processMessages(
            redis,
            identity[0],
            readers.readGroup(identity[0], identity[1], selectedKeys, selected),
            handle,
            options,
          );
          return history.pipe(Stream.concat(incoming));
        }),
      ),
  };
};

export type RedisStreamsClient = ReturnType<typeof makeRedisStreams>;

export class RedisStreams extends Context.Service<RedisStreams, RedisStreamsClient>()(
  "@effect-kit/redis/RedisStreams",
) {
  static readonly layer = Layer.effect(
    RedisStreams,
    Effect.gen(function* () {
      return makeRedisStreams(yield* Redis, yield* RedisSessions);
    }),
  );
}
