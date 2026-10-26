import assert from "node:assert/strict";

import { Effect, Stream } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

const bytes = (value: string) => new TextEncoder().encode(value);
const normalized = (values: ReadonlyArray<Uint8Array>) =>
  [...new Set(values.map((value) => Buffer.from(value).toString("hex")))].toSorted();

export const scans = Effect.fnUntraced(function* ({
  redis,
  prefix,
  check,
  record,
  policy,
  rejected,
  raw,
}: Client) {
  const C = core.Commands;
  const namespace = `${prefix}:scan`;
  const names = [0, 1, 2, 3, 4, 5].map((index) => `${namespace}:key:${index}`);
  for (const name of names) yield* redis.set(name, "v");

  yield* check("scans.page", C.scan("0", { match: `${namespace}:key:*`, count: 2 }), (page) =>
    assert.match(page.cursor, /^[0-9]+$/),
  );
  const keys = yield* Stream.runCollect(redis.scanKeys({ match: `${namespace}:key:*`, count: 2 }));
  assert.deepEqual(normalized(keys), normalized(names.map(bytes)));
  record("scans.lazy-keys-complete", "SCAN");

  const hash = `${namespace}:hash`;
  const set = `${namespace}:set`;
  const sorted = `${namespace}:sorted`;
  const binary = new Uint8Array([0, 255]);
  yield* redis.hset(hash, [[binary, binary]]);
  yield* redis.sadd(set, [binary]);
  yield* redis.zadd(sorted, [[1, binary]]);
  yield* check("scans.hash-page", C.hscan(hash), { cursor: "0", entries: [[binary, binary]] });
  yield* check("scans.set-page", C.sscan(set), { cursor: "0", entries: [binary] });
  yield* check("scans.sorted-page", C.zscan(sorted), { cursor: "0", entries: [[binary, "1"]] });
  assert.deepEqual(yield* Stream.runCollect(redis.scanHash(hash)), [[binary, binary]]);
  assert.deepEqual(yield* Stream.runCollect(redis.scanSet(set)), [binary]);
  assert.deepEqual(yield* Stream.runCollect(redis.scanSortedSet(sorted)), [[binary, "1"]]);
  record("scans.lazy-hash-binary-pairs", "HSCAN");
  record("scans.lazy-set-binary", "SSCAN");
  record("scans.lazy-sorted-scores", "ZSCAN");

  if (policy.engine !== "keydb")
    yield* check("scans.hash-novalues", C.hscanFields(hash), { cursor: "0", entries: [binary] });
  else
    yield* rejected(
      "scans.hash-novalues-rejected",
      C.hscanFields(hash),
      /^ERR.*(?:syntax|unknown|argument|option)/i,
    );
  if (policy.engine === "garnet") {
    const error = yield* Effect.flip(redis.zscanMembers(sorted));
    assert.ok(error instanceof core.ProfileError && error.delivery === "unsent");
    const reply = yield* raw(["ZSCAN", sorted, "0", "NOSCORES"]);
    assert.deepEqual(reply, {
      _tag: "Array",
      values: [
        { _tag: "BlobString", value: bytes("0") },
        {
          _tag: "Array",
          values: [
            { _tag: "BlobString", value: binary },
            { _tag: "BlobString", value: bytes("1") },
          ],
        },
      ],
    });
    record("scans.ignored-noscores-profile-guard", "ZSCAN", "different");
  } else if (policy.engine === "valkey")
    yield* check("scans.sorted-noscores", C.zscanMembers(sorted), {
      cursor: "0",
      entries: [binary],
    });
  else
    yield* rejected(
      "scans.sorted-noscores-rejected",
      C.zscanMembers(sorted),
      /^ERR.*(?:syntax|unknown|argument|option)/i,
    );
});
