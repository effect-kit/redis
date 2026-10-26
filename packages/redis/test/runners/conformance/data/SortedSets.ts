import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

const bytes = (value: string) => new TextEncoder().encode(value);

const length = (count: number) => (values: ReadonlyArray<unknown>) =>
  assert.equal(values.length, count);

export const sortedSets = Effect.fnUntraced(function* ({ redis, prefix, check }: Client) {
  const C = core.Commands;
  const a = `${prefix}:sorted:a`;
  const b = `${prefix}:sorted:b`;
  const out = `${prefix}:sorted:out`;

  yield* check(
    "sorted.add",
    C.zadd(a, [
      [1, "a"],
      [2, "b"],
      [3, "c"],
    ]),
    3n,
  );
  yield* check("sorted.cardinality", C.zcard(a), 3n);
  yield* check("sorted.add-increment", C.zaddIncrement(a, 1, "a"), Option.some("2"));
  yield* check("sorted.increment", C.zincrby(a, -1, "a"), "1");
  yield* check("sorted.score", C.zscore(a, "a"), Option.some(1));
  yield* check("sorted.score-token", C.zscoreToken(a, "a"), Option.some("1"));
  yield* check("sorted.scores-order", C.zmscore(a, ["a", "missing"]), [
    Option.some("1"),
    Option.none(),
  ]);
  yield* check("sorted.rank", C.zrank(a, "a"), Option.some(0n));
  yield* check("sorted.reverse-rank", C.zrevrank(a, "a"), Option.some(2n));
  yield* check("sorted.count", C.zcount(a, { exclusive: 1 }, "+inf"), 2n);
  yield* check("sorted.range", C.zrange(a, { by: "rank", start: 0, end: -1 }), [
    bytes("a"),
    bytes("b"),
    bytes("c"),
  ]);
  yield* check(
    "sorted.range-details",
    C.zrangeWithScores(a, {
      by: "score",
      min: 1,
      max: 3,
      reverse: true,
      limit: { offset: 0, count: 2 },
    }),
    [
      [bytes("c"), "3"],
      [bytes("b"), "2"],
    ],
  );
  yield* check("sorted.range-store", C.zrangestore(out, a, { by: "rank", start: 0, end: 1 }), 2n);
  yield* check("sorted.reverse", C.zrevrange(a, 0, -1), length(3));
  yield* check("sorted.reverse-scores", C.zrevrangeWithScores(a, 0, 0), [[bytes("c"), "3"]]);
  yield* check("sorted.by-score", C.zrangebyscore(a, "-inf", "+inf"), length(3));
  yield* check("sorted.by-score-details", C.zrangebyscoreWithScores(a, 1, 1), [[bytes("a"), "1"]]);
  yield* check("sorted.reverse-score", C.zrevrangebyscore(a, 3, 1), length(3));
  yield* check("sorted.reverse-score-details", C.zrevrangebyscoreWithScores(a, 3, 3), [
    [bytes("c"), "3"],
  ]);
  yield* check("sorted.random", C.zrandmember(a), (value) => assert.ok(Option.isSome(value)));
  yield* check("sorted.random-count", C.zrandmemberCount(a, -4), length(4));
  yield* check("sorted.random-scores", C.zrandmemberWithScores(a, 2), length(2));

  yield* redis.zadd(b, [
    [2, "b"],
    [4, "d"],
  ]);
  yield* check("sorted.difference", C.zdiff([a, b]), [bytes("a"), bytes("c")]);
  yield* check("sorted.difference-scores", C.zdiffWithScores([a, b]), [
    [bytes("a"), "1"],
    [bytes("c"), "3"],
  ]);
  yield* check("sorted.difference-store", C.zdiffstore(out, [a, b]), 2n);
  yield* check("sorted.intersection", C.zinter([a, b]), [bytes("b")]);
  yield* check(
    "sorted.weighted-intersection",
    C.zinterWithScores([a, b], { weights: [2, 3], aggregate: "SUM" }),
    [[bytes("b"), "10"]],
  );
  yield* check("sorted.union", C.zunion([a, b]), length(4));
  yield* check("sorted.union-scores", C.zunionWithScores([a, b], { aggregate: "MAX" }), length(4));
  yield* check("sorted.intersection-store", C.zinterstore(out, [a, b]), 1n);
  yield* check("sorted.union-store", C.zunionstore(out, [a, b]), 4n);

  const lex = `${prefix}:lex`;
  yield* redis.zadd(lex, [
    [0, "a"],
    [0, "b"],
    [0, "c"],
  ]);
  yield* check(
    "sorted.lex-count",
    C.zlexcount(lex, { value: "a" }, { value: "c", exclusive: true }),
    2n,
  );
  yield* check("sorted.lex-range", C.zrange(lex, { by: "lex", min: "-", max: "+" }), length(3));
  yield* check("sorted.lex", C.zrangebylex(lex, "-", "+"), length(3));
  yield* check("sorted.reverse-lex", C.zrevrangebylex(lex, "+", "-"), length(3));
  yield* check("sorted.remove-lex", C.zremrangebylex(lex, { value: "a" }, { value: "b" }), 2n);
  yield* check("sorted.remove-rank", C.zremrangebyrank(lex, 0, -1), 1n);
  yield* check("sorted.remove-score", C.zremrangebyscore(out, 0, "+inf"), 4n);
  yield* check("sorted.remove", C.zrem(a, ["missing"]), 0n);
  yield* check("sorted.pop-min", C.zpopmin(a), [[bytes("a"), "1"]]);
  yield* check("sorted.pop-max", C.zpopmax(a), [[bytes("c"), "3"]]);
  yield* check("sorted.intercard", C.zintercard([a, b]), 1n);
  yield* check("sorted.mpop", C.zmpop([a], "MIN"), Option.some([bytes(a), [[bytes("b"), "2"]]]));
});
