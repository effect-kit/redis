import { Effect } from "effect";

import { array } from "#/command/reply/Collections";
import { pairs } from "#/command/reply/Data";
import { blob } from "#/command/reply/Scalars";
import { scoreToken } from "#/command/reply/Score";
import { keyed } from "#/commands/internal/Command";
import { integer } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/sorted-sets/Catalog";
import { lexBound, limit, scoreBound } from "#/commands/sorted-sets/internal/Bounds";
import type { LexBound, RangeLimit, ScoreBound } from "#/commands/sorted-sets/internal/Bounds";
import type { RedisArgument } from "#/RedisArgument";

const scoreRange = (first: ScoreBound, second: ScoreBound, selected?: RangeLimit) =>
  Effect.gen(function* () {
    return [yield* scoreBound(first), yield* scoreBound(second), ...(yield* limit(selected))];
  });

const lexRange = (first: LexBound, second: LexBound, selected?: RangeLimit) =>
  Effect.gen(function* () {
    return [yield* lexBound(first), yield* lexBound(second), ...(yield* limit(selected))];
  });

export const zrevrange = (key: RedisArgument, start: Integer, end: Integer) =>
  keyed(catalog.ZREVRANGE, key, Effect.all([integer(start), integer(end)]), array(blob));

export const zrevrangeWithScores = (key: RedisArgument, start: Integer, end: Integer) =>
  keyed(
    catalog.ZREVRANGE,
    key,
    Effect.all([integer(start), integer(end)]).pipe(
      Effect.map((bounds) => bounds.concat("WITHSCORES")),
    ),
    pairs(blob, scoreToken),
  );

export const zrangebyscore = (
  key: RedisArgument,
  min: ScoreBound,
  max: ScoreBound,
  selected?: RangeLimit,
) => keyed(catalog.ZRANGEBYSCORE, key, scoreRange(min, max, selected), array(blob));

export const zrangebyscoreWithScores = (
  key: RedisArgument,
  min: ScoreBound,
  max: ScoreBound,
  selected?: RangeLimit,
) =>
  keyed(
    catalog.ZRANGEBYSCORE,
    key,
    scoreRange(min, max, selected).pipe(Effect.map((args) => args.concat("WITHSCORES"))),
    pairs(blob, scoreToken),
  );

export const zrevrangebyscore = (
  key: RedisArgument,
  max: ScoreBound,
  min: ScoreBound,
  selected?: RangeLimit,
) => keyed(catalog.ZREVRANGEBYSCORE, key, scoreRange(max, min, selected), array(blob));

export const zrevrangebyscoreWithScores = (
  key: RedisArgument,
  max: ScoreBound,
  min: ScoreBound,
  selected?: RangeLimit,
) =>
  keyed(
    catalog.ZREVRANGEBYSCORE,
    key,
    scoreRange(max, min, selected).pipe(Effect.map((args) => args.concat("WITHSCORES"))),
    pairs(blob, scoreToken),
  );

export const zrangebylex = (
  key: RedisArgument,
  min: LexBound,
  max: LexBound,
  selected?: RangeLimit,
) => keyed(catalog.ZRANGEBYLEX, key, lexRange(min, max, selected), array(blob));

export const zrevrangebylex = (
  key: RedisArgument,
  max: LexBound,
  min: LexBound,
  selected?: RangeLimit,
) => keyed(catalog.ZREVRANGEBYLEX, key, lexRange(max, min, selected), array(blob));
