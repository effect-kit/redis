import { Effect, Option, Schema, Stream } from "effect";

import { parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { AutoClaimOptions } from "#/commands/streams/Claims";
import { compareIds } from "#/commands/streams/Id";
import type { StreamId } from "#/commands/streams/Id";
import { ReadOptionsSchema } from "#/commands/streams/Read";
import { StreamConsumerError } from "#/errors/StreamConsumerError";
import type { RedisClient } from "#/Redis";
import type { RedisArgument } from "#/RedisArgument";
import { argumentBytes, equalBytes } from "#/streams/internal/Argument";
import type { GroupMessage } from "#/streams/Types";

const PendingOptions = Schema.Struct({
  count: ReadOptionsSchema.fields.count,
  maxCount: ReadOptionsSchema.fields.maxCount,
  maxSize: ReadOptionsSchema.fields.maxSize,
});
export type PendingReadOptions = typeof PendingOptions.Type;

export const makeRecovery = (redis: RedisClient) => ({
  pending: (
    key: RedisArgument,
    group: RedisArgument,
    consumer: RedisArgument,
    options: PendingReadOptions = {},
  ) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const selected = yield* parse(PendingOptions, options);
        const count =
          selected.count ??
          (selected.maxCount !== undefined && selected.maxCount < 64 ? selected.maxCount : 64);
        return Stream.paginate("0-0" as StreamId, (cursor) =>
          redis.xreadgroup(group, consumer, [[key, cursor]], { ...selected, count }).pipe(
            Effect.flatMap((result) => {
              const batches = Option.getOrElse(result, () => []);
              if (batches.some((batch) => !equalBytes(argumentBytes(key), batch.key)))
                return Effect.fail(new StreamConsumerError({ reason: "invalid-response" }));
              const entries: ReadonlyArray<GroupMessage> = batches.flatMap((batch) =>
                batch.entries.map((entry) => ({ stream: batch.key, entry })),
              );
              const last = entries.at(-1)?.entry.id;
              let previous = cursor;
              for (const message of entries) {
                if (compareIds(message.entry.id, previous) <= 0n)
                  return Effect.fail(new StreamConsumerError({ reason: "invalid-response" }));
                previous = message.entry.id;
              }
              return Effect.succeed([
                entries,
                last === undefined ? Option.none<StreamId>() : Option.some(last),
              ] as const);
            }),
          ),
        );
      }),
    ),

  /** Emits complete claim pages, including deletion evidence and legacy unavailable entries. */
  claim: (
    key: RedisArgument,
    group: RedisArgument,
    consumer: RedisArgument,
    minIdleMillis: Integer,
    options: AutoClaimOptions = {},
  ) =>
    Stream.paginate("0-0" as StreamId, (cursor) =>
      redis
        .xautoclaim(key, group, consumer, minIdleMillis, cursor, {
          ...options,
          count: options.count ?? 64,
        })
        .pipe(
          Effect.flatMap((page) =>
            page.cursor !== "0-0" && compareIds(page.cursor, cursor) <= 0n
              ? Effect.fail(new StreamConsumerError({ reason: "invalid-response" }))
              : Effect.succeed([
                  [page],
                  page.cursor === "0-0" ? Option.none<StreamId>() : Option.some(page.cursor),
                ] as const),
          ),
        ),
    ),
});
