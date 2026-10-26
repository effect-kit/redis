import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

const bytes = (value: string) => new TextEncoder().encode(value);

const unordered = (expected: ReadonlyArray<Uint8Array>) => (actual: ReadonlyArray<Uint8Array>) => {
  assert.deepEqual(
    actual.map((value) => Buffer.from(value).toString("hex")).toSorted(),
    expected.map((value) => Buffer.from(value).toString("hex")).toSorted(),
  );
};

export const sets = Effect.fnUntraced(function* ({ redis, prefix, check }: Client) {
  const C = core.Commands;
  const a = `${prefix}:set:a`;
  const b = `${prefix}:set:b`;
  const out = `${prefix}:set:out`;
  const binary = new Uint8Array([0, 255]);

  yield* check("sets.add", C.sadd(a, ["a", "b", binary]), 3n);
  yield* redis.sadd(b, ["b", "c"]);
  yield* check("sets.cardinality", C.scard(a), 3n);
  yield* check("sets.member", C.sismember(a, binary), true);
  yield* check("sets.membership-order", C.smismember(a, ["missing", binary]), [false, true]);
  yield* check("sets.members", C.smembers(a), unordered([bytes("a"), bytes("b"), binary]));
  yield* check("sets.difference", C.sdiff([a, b]), unordered([bytes("a"), binary]));
  yield* check("sets.intersection", C.sinter([a, b]), [bytes("b")]);
  yield* check(
    "sets.union",
    C.sunion([a, b]),
    unordered([bytes("a"), bytes("b"), bytes("c"), binary]),
  );
  yield* check("sets.diffstore", C.sdiffstore(out, [a, b]), 2n);
  yield* check("sets.interstore", C.sinterstore(out, [a, b]), 1n);
  yield* check("sets.unionstore", C.sunionstore(out, [a, b]), 4n);
  yield* check("sets.random", C.srandmember(a), (value) => assert.ok(Option.isSome(value)));
  yield* check("sets.random-count", C.srandmemberCount(a, -4), (values) =>
    assert.equal(values.length, 4),
  );
  yield* check("sets.move", C.smove(a, b, "a"), true);
  yield* check("sets.remove", C.srem(b, ["missing", "a"]), 1n);
  yield* check("sets.missing-pop", C.spop(`${a}:missing`), Option.none());
  yield* check("sets.pop-count", C.spopCount(out, 2), (values) => assert.equal(values.length, 2));
  yield* check("sets.intercard", C.sintercard([a, b], { limit: 1 }), 1n);
  yield* check("sets.diffcard", C.sdiffcard([a, b]), 1n);
  yield* check("sets.unioncard", C.sunioncard([a, b]), 3n);
});
