import assert from "node:assert/strict";

import { Effect } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

export const search = Effect.fnUntraced(function* ({ redis, prefix, check, policy }: Client) {
  const C = core.Commands;
  const index = `${prefix}:index`;
  const document = `${prefix}:doc:one`;

  yield* check(
    "search.create-tag",
    C.ftCreate(index, [{ field: "tag", type: "TAG" }], {
      on: "HASH",
      prefixes: [`${prefix}:doc:`],
    }),
    undefined,
  );
  yield* redis.hset(document, [["tag", "a"]]);
  yield* check("search.tag", C.ftSearch(index, "@tag:{a}", { dialect: 2 }), (result) => {
    assert.equal(result.total, 1n);
    assert.deepEqual(result.documents[0]?.id, new TextEncoder().encode(document));
  });
  yield* check("search.list", C.ftList(), (values) => assert.ok(values.includes(index)));
  yield* check("search.info", C.ftInfo(index), (values) => assert.ok(values.length > 0));
  yield* check("search.drop", C.ftDropindex(index), undefined);

  if (policy.engine === "kvrocks") {
    // Kvrocks' query dialect supports TAG/NUMERIC, not Redis full-text TEXT indexes.
    const error = yield* Effect.flip(
      redis.ftCreate(`${index}:text`, [{ field: "title", type: "TEXT" }]),
    );
    assert.ok(error instanceof core.ServerError);
  }
});
