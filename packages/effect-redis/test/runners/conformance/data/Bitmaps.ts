import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

export const bitmaps = Effect.fnUntraced(function* ({
  redis,
  prefix,
  check,
  raw,
  policy,
  record,
  rejected,
}: Client) {
  const C = core.Commands;
  const key = `${prefix}:bits`;

  yield* check("bits.get-missing", C.getbit(key, 0), 0);
  yield* check("bits.set", C.setbit(key, 0, 1), 0);
  yield* redis.setbit(key, 7, 1);
  yield* check("bits.count", C.bitcount(key), 2n);
  yield* check("bits.count-range", C.bitcount(key, { start: 0, end: 0 }), 2n);
  yield* check("bits.position", C.bitpos(key, 1), 0n);
  yield* check("bits.not", C.bitop("NOT", `${key}:not`, [key]), 1n);
  assert.deepEqual(yield* raw(["GET", `${key}:not`]), {
    _tag: "BlobString",
    value: new Uint8Array([126]),
  });

  const field = `${key}:field`;
  yield* check(
    "bits.field-overflow",
    C.bitfield(field, [
      { operation: "SET", encoding: { signed: false, bits: 3 }, offset: 0, value: 7 },
      {
        operation: "INCRBY",
        encoding: { signed: false, bits: 3 },
        offset: 0,
        value: 1,
        overflow: "FAIL",
      },
      { operation: "GET", encoding: { signed: false, bits: 3 }, offset: 0 },
      {
        operation: "SET",
        encoding: { signed: true, bits: 64 },
        offset: { index: 1 },
        value: -9007199254740993n,
      },
    ]),
    [
      Option.some(0n),
      Option.none(),
      Option.some(policy.engine === "garnet" ? 0n : 7n),
      Option.some(0n),
    ],
    policy.engine === "garnet" ? "different" : "passed",
  );
  yield* check(
    "bits.field-ro-int64",
    C.bitfieldRo(field, [{ operation: "GET", encoding: { signed: true, bits: 64 }, offset: 64 }]),
    [policy.engine === "kvrocks" ? -1n : -9007199254740993n],
    policy.engine === "kvrocks" ? "different" : "passed",
  );

  const expectedHex =
    policy.engine === "kvrocks"
      ? "0700000000000000fffbffffffffffff"
      : policy.engine === "garnet"
        ? "0000000000000000ffdfffffffffffff"
        : "e000000000000000ffdfffffffffffff";
  assert.deepEqual(yield* raw(["GET", field]), {
    _tag: "BlobString",
    value: new Uint8Array(Buffer.from(expectedHex, "hex")),
  });
  record(
    "bits.independent-stored-bit-order",
    "GET",
    ["kvrocks", "garnet"].includes(policy.engine) ? "different" : "passed",
  );

  const a = `${prefix}:hll:a`;
  const b = `${prefix}:hll:b`;
  const out = `${prefix}:hll:out`;
  if (policy.engine === "dragonfly")
    yield* rejected("hll.empty-arity-rejection", C.pfadd(a), /^ERR wrong number of arguments/i);
  else
    yield* check(
      "hll.empty",
      C.pfadd(a),
      !["garnet", "kvrocks"].includes(policy.engine),
      ["garnet", "kvrocks"].includes(policy.engine) ? "different" : "passed",
    );
  yield* check("hll.empty-count", C.pfcount([a]), 0n);
  yield* redis.pfadd(a, ["a", "b", new Uint8Array([0, 255])]);
  yield* redis.pfadd(b, ["b", "c"]);
  yield* check("hll.merge", C.pfmerge(out, [a, b]), undefined);
  yield* check("hll.count", C.pfcount([out]), (estimate) =>
    assert.ok(estimate >= 3n && estimate <= 5n),
  );
});
