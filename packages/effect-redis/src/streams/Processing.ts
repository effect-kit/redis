import { Duration, Effect, Option, Predicate, Redacted, Schema, Stream } from "effect";

import { Argument, parse } from "#/commands/internal/Input";
import { PositiveInteger } from "#/config/Validation";
import { StreamConsumerError } from "#/errors/StreamConsumerError";
import type { RedisClient } from "#/Redis";
import type { RedisArgument } from "#/RedisArgument";
import type { GroupMessage, ProcessingOutcome } from "#/streams/Types";

const Decision = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Retry"), delay: Schema.Duration }),
  Schema.Struct({ _tag: Schema.Literal("LeavePending") }),
  Schema.Struct({ _tag: Schema.Literal("Acknowledge") }),
]);
export type FailureDecision = typeof Decision.Type;

export interface ProcessingOptions<E, EP = never, RP = never> {
  readonly concurrency?: number;
  readonly maxAttempts?: number;
  /** An Acknowledge decision is explicit; a dead-letter Effect must succeed before returning it. */
  readonly onFailure?: (
    error: E | StreamConsumerError,
    message: GroupMessage,
    attempt: number,
  ) => Effect.Effect<FailureDecision, EP, RP>;
}

const defaulted = (maximum: number) =>
  PositiveInteger.check(Schema.isLessThanOrEqualTo(maximum)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(1)),
  );
const Policy = Schema.Struct({
  concurrency: defaulted(256),
  maxAttempts: defaulted(100),
  onFailure: Schema.optionalKey(Schema.Unknown),
});

const acknowledge = (redis: RedisClient, group: RedisArgument, message: GroupMessage) =>
  redis
    .xack(message.stream, group, [message.entry.id])
    .pipe(
      Effect.flatMap((count) =>
        count === 1n
          ? Effect.void
          : Effect.fail(new StreamConsumerError({ reason: "acknowledgment-missing" })),
      ),
    );

export const processMessages = <A, E, R, ES, RS, EP = never, RP = never>(
  redis: RedisClient,
  group: RedisArgument,
  source: Stream.Stream<GroupMessage, ES, RS>,
  handle: (message: GroupMessage) => Effect.Effect<A, E, R>,
  options: ProcessingOptions<E, EP, RP> = {},
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const policy = yield* parse(Policy, options);
      const identity = yield* parse(Argument, group);
      const onFailure = options.onFailure;
      if (policy.onFailure !== undefined && !Predicate.isFunction(policy.onFailure))
        return yield* new StreamConsumerError({ reason: "invalid-policy" });

      const process = Effect.fnUntraced(function* (message: GroupMessage) {
        for (let attempt = 1; ; attempt++) {
          const action: Effect.Effect<A, E | StreamConsumerError, R> = Option.isNone(
            message.entry.fields,
          )
            ? Effect.fail(new StreamConsumerError({ reason: "tombstone" }))
            : Effect.suspend(() => handle(message));
          const result = yield* Effect.result(action);

          if (result._tag === "Success") {
            yield* acknowledge(redis, identity, message);
            return { _tag: "Processed", message, result: result.success } as const;
          }

          if (onFailure === undefined) return yield* Effect.fail(result.failure);
          const decision = yield* onFailure(result.failure, message, attempt).pipe(
            Effect.flatMap((value) =>
              Schema.decodeUnknownEffect(Decision)(value).pipe(
                Effect.mapError(() => new StreamConsumerError({ reason: "invalid-policy" })),
              ),
            ),
          );

          if (decision._tag === "LeavePending")
            return { _tag: "Pending", message, error: Redacted.make(result.failure) } as const;
          if (decision._tag === "Acknowledge") {
            yield* acknowledge(redis, identity, message);
            return { _tag: "Handled", message } as const;
          }

          if (attempt >= policy.maxAttempts) return yield* Effect.fail(result.failure);
          const millis = Duration.toMillis(decision.delay);
          if (!Number.isFinite(millis) || millis < 0)
            return yield* new StreamConsumerError({ reason: "invalid-policy" });

          yield* Effect.sleep(decision.delay);
          yield* Effect.yieldNow;
        }
      });

      return source.pipe(
        Stream.mapEffect(process, { concurrency: policy.concurrency }),
      ) satisfies Stream.Stream<ProcessingOutcome<A, E | StreamConsumerError>, unknown, unknown>;
    }),
  );
