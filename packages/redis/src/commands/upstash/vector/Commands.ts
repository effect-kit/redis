import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { boolean, nullable, tuple, unsigned } from "#/command/reply/Data";
import { mismatch, safeInteger } from "#/command/reply/Scalars";
import { parse } from "#/commands/internal/Input";
import { command, Name, named } from "#/commands/upstash/Build";
import { extensionBytes, field, fields, finiteScore, literal } from "#/commands/upstash/Reply";
import { vectorArguments } from "#/commands/upstash/vector/Input";
import type { UpstashVectorInput } from "#/commands/upstash/vector/Input";
import type { RedisArgument } from "#/RedisArgument";

const Metric = Schema.Literals(["COSINE", "EUCLIDEAN", "DOT"]);
const Create = Schema.Struct({
  dimension: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32768 })),
  metric: Metric,
  existsOk: Schema.optionalKey(Schema.Boolean),
});
export type VectorCreateOptions = typeof Create.Type;

export const vectorCreate = (index: RedisArgument, options: VectorCreateOptions) =>
  command(
    "VECTOR.CREATE",
    boolean,
    Effect.gen(function* () {
      const name = yield* parse(Name, index);
      const selected = yield* parse(Create, options);
      return [
        name,
        "DIM",
        String(selected.dimension),
        "METRIC",
        selected.metric,
        ...(selected.existsOk ? ["EXISTSOK"] : []),
      ];
    }),
  );

export const vectorAdd = (index: RedisArgument, id: RedisArgument, vector: UpstashVectorInput) =>
  command(
    "VECTOR.ADD",
    boolean,
    Effect.gen(function* () {
      return [
        yield* parse(Name, index),
        yield* parse(Name, id),
        ...(yield* vectorArguments(vector)),
      ];
    }),
  );

export const vectorGet = (index: RedisArgument, id: RedisArgument) =>
  command(
    "VECTOR.GET",
    nullable(array(finiteScore)),
    Effect.all([parse(Name, index), parse(Name, id)]),
  );
export const vectorDel = (index: RedisArgument, id: RedisArgument) =>
  command("VECTOR.DEL", boolean, Effect.all([parse(Name, index), parse(Name, id)]));
export const vectorCount = (index: RedisArgument) => named("VECTOR.COUNT", index, unsigned);
export const vectorDrop = (index: RedisArgument) => named("VECTOR.DROP", index, boolean);

export const vectorInfo = (index: RedisArgument) =>
  named(
    "VECTOR.INFO",
    index,
    nullable((reply) =>
      Effect.gen(function* () {
        const entries = yield* fields(reply);
        const dimension = yield* safeInteger(yield* field(entries, "dimension", reply));
        if (dimension < 1 || dimension > 32768) return yield* mismatch("custom", reply);
        return {
          dimension,
          metric: yield* literal(["COSINE", "EUCLIDEAN", "DOT"])(
            yield* field(entries, "metric", reply),
          ),
        };
      }),
    ),
  );

const Query = Schema.Struct({
  topK: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
  profile: Schema.optionalKey(Schema.Literals(["FAST", "BALANCED", "PRECISE"])),
});
export type VectorQueryOptions = typeof Query.Type;
export interface VectorHit {
  readonly id: Uint8Array;
  readonly score: number;
}

export const vectorQuery = (
  index: RedisArgument,
  vector: UpstashVectorInput,
  options: VectorQueryOptions,
) => ({
  prepare: Effect.gen(function* () {
    const selected = yield* parse(Query, options);
    return yield* command(
      "VECTOR.QUERY",
      (reply) =>
        array(tuple(extensionBytes, finiteScore))(reply).pipe(
          Effect.flatMap((hits) => {
            if (hits.length > selected.topK || hits.some(([, score]) => score < 0 || score > 1))
              return Effect.fail(mismatch("custom", reply));
            return Effect.succeed(hits.map(([id, score]): VectorHit => ({ id, score })));
          }),
        ),
      Effect.gen(function* () {
        return [
          yield* parse(Name, index),
          "TOPK",
          String(selected.topK),
          ...(yield* vectorArguments(vector)),
          ...(selected.profile === undefined ? [] : ["PROFILE", selected.profile]),
        ];
      }),
    ).prepare;
  }),
});
