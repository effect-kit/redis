import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { pairs } from "#/command/reply/Data";
import { blob, integer } from "#/command/reply/Scalars";
import { scoreToken } from "#/command/reply/Score";
import { keyed, ordinary } from "#/commands/internal/Command";
import { Integer, parse } from "#/commands/internal/Input";
import { catalog } from "#/commands/sorted-sets/Catalog";
import { lexBound, limit, Limit, scoreBound } from "#/commands/sorted-sets/internal/Bounds";
import type { LexBound, RangeLimit, ScoreBound } from "#/commands/sorted-sets/internal/Bounds";
import { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

export type {
  LexBound,
  RangeLimit,
  Score,
  ScoreBound,
} from "#/commands/sorted-sets/internal/Bounds";

export type SortedRange =
  | {
      readonly by: "rank";
      readonly start: Integer;
      readonly end: Integer;
      readonly reverse?: boolean;
    }
  | {
      readonly by: "score";
      readonly min: ScoreBound;
      readonly max: ScoreBound;
      readonly reverse?: boolean;
      readonly limit?: RangeLimit;
    }
  | {
      readonly by: "lex";
      readonly min: LexBound;
      readonly max: LexBound;
      readonly reverse?: boolean;
      readonly limit?: RangeLimit;
    };

const encodeRange = (range: SortedRange) =>
  Effect.gen(function* () {
    // Validate the discriminant/options before consulting branch-specific fields.
    const o = yield* parse(
      Schema.Struct({
        by: Schema.Literals(["rank", "score", "lex"]),
        reverse: Schema.optionalKey(Schema.Boolean),
        start: Schema.optionalKey(Integer),
        end: Schema.optionalKey(Integer),
        min: Schema.optionalKey(Schema.Unknown),
        max: Schema.optionalKey(Schema.Unknown),
        limit: Schema.optionalKey(Limit),
      }),
      range,
    );
    let bounds: string[] | RedisArgument[];
    const flags: RedisArgument[] = [];
    if (o.by === "rank") {
      const selected = yield* parse(Schema.Struct({ start: Integer, end: Integer }), {
        start: o.start,
        end: o.end,
      });
      if (o.min !== undefined || o.max !== undefined || o.limit !== undefined)
        return yield* new CommandInputError({ delivery: "unsent", reason: "options" });
      bounds = [String(selected.start), String(selected.end)];
    } else {
      const min =
        o.by === "score"
          ? yield* scoreBound(o.min as ScoreBound)
          : yield* lexBound(o.min as LexBound);
      const max =
        o.by === "score"
          ? yield* scoreBound(o.max as ScoreBound)
          : yield* lexBound(o.max as LexBound);
      if (o.start !== undefined || o.end !== undefined)
        return yield* new CommandInputError({ delivery: "unsent", reason: "options" });
      bounds = o.reverse ? [max, min] : [min, max];
      flags.push(o.by === "score" ? "BYSCORE" : "BYLEX");
    }
    if (o.reverse) flags.push("REV");
    return [...bounds, ...flags, ...(yield* limit(o.limit))];
  });

export const zrange = (key: RedisArgument, range: SortedRange) =>
  keyed(catalog.ZRANGE, key, encodeRange(range), array(blob));

export const zrangeWithScores = (key: RedisArgument, range: SortedRange) =>
  keyed(
    catalog.ZRANGE,
    key,
    encodeRange(range).pipe(Effect.map((args) => [...args, "WITHSCORES"])),
    pairs(blob, scoreToken),
  );

export const zrangestore = (
  destination: RedisArgument,
  source: RedisArgument,
  range: SortedRange,
) =>
  ordinary(
    catalog.ZRANGESTORE,
    integer,
    encodeRange(range).pipe(
      Effect.map((args) => ({
        tokens: ["ZRANGESTORE", destination, source, ...args],
        routing: {
          _tag: "Keys",
          keys: [
            { index: 1, access: "write" },
            { index: 2, access: "read" },
          ],
        },
      })),
    ),
  );

export const zcount = (key: RedisArgument, min: ScoreBound, max: ScoreBound) =>
  keyed(catalog.ZCOUNT, key, Effect.all([scoreBound(min), scoreBound(max)]), integer);

export const zlexcount = (key: RedisArgument, min: LexBound, max: LexBound) =>
  keyed(catalog.ZLEXCOUNT, key, Effect.all([lexBound(min), lexBound(max)]), integer);

export const zremrangebyrank = (key: RedisArgument, start: Integer, end: Integer) =>
  keyed(
    catalog.ZREMRANGEBYRANK,
    key,
    Effect.gen(function* () {
      return [String(yield* parse(Integer, start)), String(yield* parse(Integer, end))];
    }),
    integer,
    "read-write",
  );

export const zremrangebyscore = (key: RedisArgument, min: ScoreBound, max: ScoreBound) =>
  keyed(
    catalog.ZREMRANGEBYSCORE,
    key,
    Effect.all([scoreBound(min), scoreBound(max)]),
    integer,
    "read-write",
  );

export const zremrangebylex = (key: RedisArgument, min: LexBound, max: LexBound) =>
  keyed(
    catalog.ZREMRANGEBYLEX,
    key,
    Effect.all([lexBound(min), lexBound(max)]),
    integer,
    "read-write",
  );
