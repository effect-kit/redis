// Compile-only session contracts; Vitest never executes this file.
import { Duration, Effect } from "effect";
import type { Option, Redacted, Result } from "effect";

import { Commands, RedisKey } from "#/index";
import type {
  BatchExecutor,
  RedisClient,
  RedisSession,
  RedisSessionsClient,
  ReplyError,
  ServerError,
} from "#/index";
import {
  type DecodeLabel,
  type EncodeLabel,
  labelSchema,
} from "#test/support/commands/SchemaServices";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type Unredact<R> = R extends Redacted.Redacted<infer A> ? A : never;

declare const redis: RedisClient;
declare const sessions: RedisSessionsClient;
declare const session: RedisSession;
const commands = [Commands.get("a"), Commands.incr("b"), Commands.zscoreToken("c", "m")] as const;
const pipeline = redis.pipeline(commands);
const nativePipeline = sessions.pipeline(commands);
const leasedPipeline = session.pipeline(commands);
const transaction = sessions.transaction(commands);
const blocked = sessions.blpop(["a"], { blockFor: Duration.seconds(1) });
const sortedPop = sessions.bzpopmin(["a"], { blockFor: "forever" });
const moved = sessions.blmovem("a", "b", "LEFT", "RIGHT", { blockFor: Duration.seconds(1) });
const replicas = session.waitForReplicas(1, { blockFor: Duration.seconds(1) });
const aof = session.waitForAof(1, 1, { blockFor: Duration.seconds(1) });
const labels = RedisKey.schemaText("label", labelSchema);
const encoded = redis.pipeline([Commands.setKey(labels, "v")]);
const decoded = redis.pipeline([Commands.getKey(labels)]);
const schemaBatch = sessions.pipeline([Commands.getKey(labels), Commands.setKey(labels, "v")]);
const suppressed = session.withoutReplies([Commands.getKey(labels)]);
const cached = session.caching("YES", Commands.getKey(labels));
const empty = sessions.pipeline([]);
type Values = Effect.Success<typeof pipeline>;
type Evidence = Unredact<
  Extract<Effect.Error<typeof pipeline>, { readonly _tag: "BatchError" }>["outcomes"]
>;
type Committed = Extract<Effect.Success<typeof transaction>, { readonly _tag: "Committed" }>;

export type SessionInference = [
  Assert<Equal<Values["length"], 3>>,
  Assert<Equal<Result.Result.Success<Values[0]>, Option.Option<string>>>,
  Assert<Equal<Result.Result.Success<Values[1]>, bigint>>,
  Assert<Equal<Result.Result.Success<Values[2]>, Option.Option<string>>>,
  Assert<Equal<Result.Result.Failure<Values[1]>, ReplyError | ServerError>>,
  Assert<Equal<Effect.Services<typeof pipeline>, BatchExecutor>>,
  Assert<Equal<Effect.Services<typeof nativePipeline>, never>>,
  Assert<Equal<Effect.Services<typeof leasedPipeline>, never>>,
  Assert<Equal<Committed["results"], Values>>,
  Assert<
    Equal<
      Extract<Effect.Success<typeof transaction>, { _tag: "Conflict" }>,
      { readonly _tag: "Conflict" }
    >
  >,
  Assert<Equal<Evidence["length"], 3>>,
  Assert<
    Equal<Result.Result.Success<Extract<Evidence[1], { _tag: "Completed" }>["result"]>, bigint>
  >,
  Assert<
    Effect.Success<typeof blocked> extends Option.Option<readonly [Uint8Array, Uint8Array]>
      ? true
      : false
  >,
  Assert<
    Option.Option<readonly [Uint8Array, Uint8Array]> extends Effect.Success<typeof blocked>
      ? true
      : false
  >,
  Assert<Equal<Option.Option.Value<Effect.Success<typeof blocked>>[0], Uint8Array>>,
  Assert<Equal<Option.Option.Value<Effect.Success<typeof blocked>>[1], Uint8Array>>,
  Assert<
    Equal<
      Effect.Success<typeof sortedPop>,
      Option.Option<readonly [Uint8Array, Uint8Array, string]>
    >
  >,
  Assert<Equal<Effect.Success<typeof moved>, Option.Option<ReadonlyArray<Uint8Array>>>>,
  Assert<Equal<Effect.Success<typeof replicas>, bigint>>,
  Assert<Equal<Effect.Success<typeof aof>, readonly [bigint, bigint]>>,
  Assert<Equal<Effect.Services<typeof encoded>, BatchExecutor | EncodeLabel>>,
  Assert<Equal<Effect.Services<typeof decoded>, BatchExecutor | DecodeLabel>>,
  Assert<Equal<Effect.Services<typeof schemaBatch>, EncodeLabel | DecodeLabel>>,
  Assert<Equal<Effect.Services<typeof suppressed>, never>>,
  Assert<Equal<Effect.Success<typeof suppressed>, void>>,
  Assert<Equal<Effect.Services<typeof cached>, DecodeLabel>>,
  Assert<Equal<Effect.Success<typeof empty>, readonly []>>,
];

// @ts-expect-error The ordinary client does not own a blocking lease.
redis.blpop(["a"], { blockFor: "forever" });

// @ts-expect-error WAIT must remain with the session's preceding writes.
redis.waitForReplicas(1, { blockFor: "forever" });

// @ts-expect-error Server wait units are explicit Effect durations.
sessions.blpop(["a"], { blockFor: 1000 });

// @ts-expect-error At least one blocking key is required.
sessions.blpop([], { blockFor: "forever" });

// @ts-expect-error WATCH needs at least one key.
sessions.watch([], () => Effect.void);

// @ts-expect-error Only local AOF counts zero and one are valid.
session.waitForAof(2, 1, { blockFor: "forever" });

// @ts-expect-error CLIENT CACHING uses its protocol mode enum.
session.caching("MAYBE", Commands.get("a"));

// @ts-expect-error CLIENT CAPA requires a nonempty list.
session.clientCapabilities([]);

// @ts-expect-error An ordinary-only composition does not provide the batch capability.
Effect.runPromise(pipeline);

// @ts-expect-error Tuple inference cannot be replaced by an unrelated result type.
const wrongTuple: Effect.Effect<readonly [bigint], unknown> = nativePipeline;
void wrongTuple;
