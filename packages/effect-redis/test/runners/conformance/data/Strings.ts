import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

const bytes = (value: string) => new TextEncoder().encode(value);

export const strings = Effect.fnUntraced(function* ({
  redis,
  prefix,
  check,
  raw,
  policy,
  record,
}: Client) {
  const C = core.Commands;
  const key = `${prefix}:string`;
  const binary = new Uint8Array([0, 255, 128, 13, 10]);

  yield* check("strings.set-binary", C.set(key, binary), undefined);
  yield* check("strings.get-binary", C.getBytes(key), Option.some(binary));
  yield* check("strings.get-missing", C.get(`${key}:missing`), Option.none());
  assert.deepEqual(yield* raw(["GET", key]), { _tag: "BlobString", value: binary });
  const invalidText = yield* Effect.flip(redis.get(key));
  assert.equal(invalidText._tag, "ReplyError");
  record("strings.get-invalid-utf8", "GET");

  yield* check("strings.set-text", C.set(key, "hello"), undefined);
  yield* check("strings.append", C.append(key, "!"), 6n);
  yield* check("strings.strlen", C.strlen(key), 6n);
  yield* check("strings.getrange", C.getrange(key, 0, 1), bytes("he"));
  yield* check("strings.substr", C.substr(key, -2, -1), bytes("o!"));
  yield* check("strings.setrange", C.setrange(key, 0, "H"), 6n);
  yield* check("strings.getset", C.getset(key, "next"), Option.some(bytes("Hello!")));
  yield* check("strings.getdel", C.getdel(key), Option.some(bytes("next")));
  yield* redis.set(key, "expiry");
  yield* check("strings.getex", C.getex(key, { type: "PERSIST" }), Option.some(bytes("expiry")));

  yield* check("strings.setnx-existing", C.setnx(key, "wrong"), false);
  yield* check("strings.setex", C.setex(key, 60, "seconds"), undefined);
  yield* check("strings.psetex", C.psetex(key, 60000, "milliseconds"), undefined);
  yield* check(
    "strings.mset",
    C.mset([
      [key, "a"],
      [`${key}:b`, "b"],
    ]),
    undefined,
  );
  yield* check("strings.mget-order", C.mget([`${key}:b`, key, `${key}:missing`]), [
    Option.some(bytes("b")),
    Option.some(bytes("a")),
    Option.none(),
  ]);
  yield* check(
    "strings.msetnx-blocked",
    C.msetnx([
      [key, "wrong"],
      [`${key}:new`, "wrong"],
    ]),
    false,
  );
  assert.deepEqual(yield* redis.get(`${key}:new`), Option.none());

  const integer = `${key}:integer`;
  yield* check("strings.incrby-int64", C.incrby(integer, 9007199254740993n), 9007199254740993n);
  yield* check("strings.decr", C.decr(integer), 9007199254740992n);
  yield* check("strings.decrby", C.decrby(integer, 2), 9007199254740990n);
  yield* check("strings.incr", C.incr(integer), 9007199254740991n);
  yield* check("strings.float-token", C.incrbyfloat(`${key}:float`, "0.5"), "0.5");

  yield* redis.mset([
    [`${key}:lcs-a`, "abc"],
    [`${key}:lcs-b`, "ac"],
  ]);
  yield* check("strings.lcs", C.lcs(`${key}:lcs-a`, `${key}:lcs-b`), bytes("ac"));
  yield* check("strings.lcs-length", C.lcsLength(`${key}:lcs-a`, `${key}:lcs-b`), 2n);
  yield* check("strings.lcs-matches", C.lcsMatches(`${key}:lcs-a`, `${key}:lcs-b`), (result) =>
    assert.equal(result.length, 2n),
  );
  yield* check("strings.digest", C.digest(key), (result) => assert.ok(Option.isSome(result)));
  yield* check(
    "strings.msetex",
    C.msetex([[`${key}:msetex`, "v"]], { expiry: { type: "EX", value: 60 } }),
    true,
  );
  yield* check("strings.delex", C.delex(`${key}:delex`), false);
  yield* check("strings.delifeq", C.delifeq(`${key}:delifeq`, "v"), false);
  yield* check(
    "strings.increx",
    C.increx(`${key}:increx`, { increment: 3, upper: 2, saturate: true }),
    [2n, 2n],
  );
  yield* check("strings.increx-float", C.increxFloat(`${key}:increx-float`, { increment: 0.5 }), [
    "0.5",
    "0.5",
  ]);

  // MSET value/order checks do not establish atomicity on engines with a documented weaker guarantee.
  if (policy.engine === "garnet") assert.deepEqual(yield* redis.get(key), Option.some("a"));
});
