import { Context, Effect, Layer, Queue, Schema } from "effect";

import type { RedisError } from "#/command/Executor";
import { Argument, Positive, parse } from "#/commands/internal/Input";
import { ftAggregateWithCursor } from "#/commands/search/query/Aggregate";
import type {
  SearchAggregateOptions,
  SearchCursorOptions,
} from "#/commands/search/query/Aggregate";
import type { SearchFields } from "#/commands/search/reply/Fields";
import type { RedisArgument } from "#/RedisArgument";
import type { SessionAccess } from "#/sessions/Access";
import { RedisSessions } from "#/sessions/RedisSessions";
import { scopedReader } from "#/streams/internal/ScopedReader";

export const makeRedisSearch = (sessions: Pick<SessionAccess, "withSession">) => ({
  /** One native lease owns cursor creation, page reads and deletion, including early consumer exit. */
  aggregate: (
    index: RedisArgument,
    query: RedisArgument,
    options: SearchAggregateOptions = {},
    cursor: SearchCursorOptions = {},
  ) =>
    scopedReader<SearchFields, RedisError>((queue) =>
      Effect.gen(function* () {
        const parsedIndex = yield* parse(Argument, index);
        const identity = typeof parsedIndex === "string" ? parsedIndex : parsedIndex.slice();
        const selected = yield* parse(
          Schema.Struct({
            count: Schema.optionalKey(Positive),
            maxIdleMillis: Schema.optionalKey(Positive),
          }),
          cursor,
        );
        const count = selected.count ?? 64;
        const settings = { count, maxIdleMillis: selected.maxIdleMillis ?? 60_000 };
        const initial = yield* ftAggregateWithCursor(identity, query, options, settings).prepare;

        return yield* sessions.withSession((session) =>
          Effect.gen(function* () {
            let cursorId = 0n;
            // Ordinary wire exchanges have finite native deadlines. Defer interruption until the cursor receipt is owned.
            const run = Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                let receipt = yield* session.executePrepared(initial);
                cursorId = receipt.cursor;
                while (true) {
                  // Empty nonterminal pages must also give pending cancellation a checkpoint.
                  yield* restore(Effect.yieldNow);
                  for (const row of receipt.page.rows) yield* restore(Queue.offer(queue, row));
                  if (cursorId === 0n) break;

                  receipt = yield* session.ftCursorRead(identity, cursorId, count);
                  cursorId = receipt.cursor;
                }
              }),
            );

            // An uncertain read is never replayed. Cleanup remains on this lease and its failure escapes the Cause.
            return yield* run.pipe(
              Effect.onExit(() =>
                Effect.suspend(() => {
                  return cursorId === 0n
                    ? Effect.void
                    : session.ftCursorDel(identity, cursorId).pipe(Effect.orDie);
                }),
              ),
            );
          }),
        );
      }),
    ),
});

export type RedisSearchClient = ReturnType<typeof makeRedisSearch>;
export class RedisSearch extends Context.Service<RedisSearch, RedisSearchClient>()(
  "@envoy1084/effect-redis/RedisSearch",
) {
  static readonly layer = Layer.effect(
    RedisSearch,
    RedisSessions.pipe(Effect.map(makeRedisSearch)),
  );
}
