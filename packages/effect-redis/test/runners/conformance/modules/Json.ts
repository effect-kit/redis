import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

export const json = Effect.fnUntraced(function* ({ prefix, check }: Client) {
  const C = core.Commands;
  const key = `${prefix}:json`;
  const bytes = new TextEncoder().encode('{"n":2,"array":[1,2],"flag":true}');

  yield* check("json.set", C.jsonSet(key, "$", bytes), true);
  yield* check("json.get", C.jsonGet(key, { paths: ["$"] }), (value) => {
    assert.ok(Option.isSome(value));
    assert.deepEqual(JSON.parse(new TextDecoder().decode(value.value)), [
      {
        n: 2,
        array: [1, 2],
        flag: true,
      },
    ]);
  });
  yield* check("json.type", C.jsonType(key), Option.some([Option.some("object")]));
  yield* check("json.object-length", C.jsonObjlen(key), Option.some([Option.some(3n)]));
  yield* check("json.array-length", C.jsonArrlen(key, "$.array"), Option.some([Option.some(2n)]));
  yield* check(
    "json.array-append",
    C.jsonArrappend(key, "$.array", ["3"]),
    Option.some([Option.some(3n)]),
  );
  yield* check("json.increment", C.jsonNumincrby(key, "$.n", 1), Option.some([Option.some("3")]));
  yield* check("json.toggle", C.jsonToggle(key, "$.flag"), Option.some([Option.some(false)]));
  yield* check("json.delete", C.jsonDel(key), 1n);
});
