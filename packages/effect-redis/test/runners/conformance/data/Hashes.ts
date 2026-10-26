import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

const bytes = (value: string) => new TextEncoder().encode(value);

export const hashes = Effect.fnUntraced(function* ({
  redis,
  prefix,
  check,
  raw,
  wrongType,
}: Client) {
  const C = core.Commands;
  const key = `${prefix}:hash`;
  const binary = new Uint8Array([0, 255]);

  yield* check(
    "hashes.set",
    C.hset(key, [
      ["a", "one"],
      [binary, binary],
    ]),
    2n,
  );
  yield* check("hashes.length", C.hlen(key), 2n);
  yield* check("hashes.get", C.hget(key, "a"), Option.some(bytes("one")));
  yield* check("hashes.text", C.hgetText(key, "a"), Option.some("one"));
  yield* check("hashes.binary", C.hget(key, binary), Option.some(binary));
  yield* check("hashes.multi-order", C.hmget(key, ["a", "missing"]), [
    Option.some(bytes("one")),
    Option.none(),
  ]);
  yield* check("hashes.exists", C.hexists(key, "missing"), false);
  yield* check("hashes.value-length", C.hstrlen(key, "a"), 3n);
  yield* check("hashes.keys", C.hkeys(key), (values) => assert.equal(values.length, 2));
  yield* check("hashes.values", C.hvals(key), (values) => assert.equal(values.length, 2));
  yield* check("hashes.pairs", C.hgetall(key), (pairs) => {
    assert.equal(pairs.length, 2);
    assert.ok(
      pairs.some(
        ([field, value]) => Buffer.from(field).equals(binary) && Buffer.from(value).equals(binary),
      ),
    );
  });

  yield* check("hashes.multi-set", C.hmset(key, [["b", "two"]]), undefined);
  yield* check("hashes.setnx", C.hsetnx(key, "b", "wrong"), false);
  yield* check("hashes.integer", C.hincrby(key, "counter", 9007199254740993n), 9007199254740993n);
  yield* check("hashes.float", C.hincrbyfloat(key, "float", "0.5"), "0.5");
  assert.deepEqual(yield* raw(["HGET", key, "counter"]), {
    _tag: "BlobString",
    value: bytes("9007199254740993"),
  });
  yield* check("hashes.random", C.hrandfield(key), (value) => assert.ok(Option.isSome(value)));
  yield* check("hashes.random-count", C.hrandfieldCount(key, -3), (values) =>
    assert.equal(values.length, 3),
  );
  yield* check("hashes.random-pairs", C.hrandfieldWithValues(key, 2), (values) =>
    assert.equal(values.length, 2),
  );
  yield* check("hashes.delete", C.hdel(key, ["b", "missing"]), 1n);

  // Each expiry spelling is exercised independently; one accepted spelling does not imply the others exist.
  yield* check("hashes.ttl", C.httl(key, ["a", "missing"]), [-1n, -2n]);
  yield* check("hashes.pttl", C.hpttl(key, ["a", "missing"]), [-1n, -2n]);
  yield* check("hashes.expire", C.hexpire(key, 60, ["a", "missing"]), [1n, -2n]);
  yield* check("hashes.pexpire", C.hpexpire(key, 120000, ["a"]), [1n]);
  yield* check("hashes.expireat", C.hexpireat(key, 4102444800n, ["a"]), [1n]);
  yield* check("hashes.pexpireat", C.hpexpireat(key, 4102444800000n, ["a"]), [1n]);
  yield* check("hashes.expiretime", C.hexpiretime(key, ["a"]), (values) =>
    assert.ok(values[0] !== undefined && values[0] > 0n),
  );
  yield* check("hashes.pexpiretime", C.hpexpiretime(key, ["a"]), (values) =>
    assert.ok(values[0] !== undefined && values[0] > 0n),
  );
  yield* check("hashes.persist", C.hpersist(key, ["a", "missing"]), [1n, -2n]);

  yield* check(
    "hashes.setex",
    C.hsetex(key, [["expiring", "v"]], { condition: "FNX", expiry: { type: "PX", value: 60000 } }),
    true,
  );
  yield* check("hashes.getex", C.hgetex(key, ["a", "missing"], { type: "PERSIST" }), [
    Option.some(bytes("one")),
    Option.none(),
  ]);
  yield* check("hashes.getdel", C.hgetdel(key, ["a", "missing"]), [
    Option.some(bytes("one")),
    Option.none(),
  ]);

  yield* redis.set(`${key}:wrong`, "string");
  yield* wrongType("hashes.wrong-type", C.hget(`${key}:wrong`, "a"));
});
