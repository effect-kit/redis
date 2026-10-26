import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

const bytes = (value: string) => new TextEncoder().encode(value);

export const streams = Effect.fnUntraced(function* ({
  redis,
  prefix,
  check,
  policy,
  raw,
  record,
}: Client) {
  const C = core.Commands;
  const key = `${prefix}:stream`;
  const binary = new Uint8Array([0, 255]);

  yield* check(
    "streams.add",
    C.xadd(key, "1-0", [
      ["f", binary],
      ["f", "second"],
    ]),
    "1-0",
  );
  yield* check("streams.length", C.xlen(key), 1n);
  const entry = {
    id: "1-0",
    fields: [
      [bytes("f"), binary],
      [bytes("f"), bytes("second")],
    ],
  } as const;
  yield* check("streams.range", C.xrange(key), [entry]);
  yield* check("streams.reverse", C.xrevrange(key), [entry]);
  yield* check(
    "streams.read",
    C.xread([[key, "0"]]),
    Option.some([{ key: bytes(key), entries: [entry] }]),
  );

  yield* check(
    "streams.group-create",
    C.xgroupCreate(key, "g", "0", { mkstream: true }),
    undefined,
  );
  yield* check("streams.consumer-create", C.xgroupCreateconsumer(key, "g", "never-active"), true);
  yield* check("streams.group-read", C.xreadgroup("g", "a", [[key, ">"]]), (value) => {
    assert.ok(Option.isSome(value));
    assert.equal(value.value[0]?.entries[0]?.id, "1-0");
  });
  yield* check("streams.pending", C.xpending(key, "g"), (value) => assert.equal(value.count, 1n));
  yield* check(
    "streams.pending-entries",
    C.xpendingEntries(key, "g", { start: "-", end: "+", count: 5 }),
    (value) => assert.equal(value[0]?.id, "1-0"),
  );
  yield* check("streams.claim-ids", C.xclaimIds(key, "g", "b", 0, ["1-0"]), ["1-0"]);
  const claimedEntry = { ...entry, fields: Option.some(entry.fields) };
  yield* check("streams.claim", C.xclaim(key, "g", "b", 0, ["1-0"]), [Option.some(claimedEntry)]);
  yield* check("streams.autoclaim-ids", C.xautoclaimIds(key, "g", "b", 0), (value) =>
    assert.deepEqual(value.entries, ["1-0"]),
  );
  yield* check("streams.autoclaim", C.xautoclaim(key, "g", "c", 0), (value) =>
    assert.deepEqual(value.entries, [Option.some(claimedEntry)]),
  );
  yield* check("streams.ack", C.xack(key, "g", ["1-0"]), 1n);
  yield* check("streams.groups", C.xinfoGroups(key), (value) =>
    assert.equal(value[0]?.pending, 0n),
  );
  yield* check("streams.consumers", C.xinfoConsumers(key, "g"), (value) =>
    assert.ok(value.length > 0),
  );
  if (policy.engine === "kvrocks") {
    // The strict Redis info model requires radix/group counters that Kvrocks does not report.
    const error = yield* Effect.flip(redis.xinfoStream(key));
    assert.ok(error instanceof core.ReplyError);
    const reply = yield* raw(["XINFO", "STREAM", key]);
    assert.equal(reply._tag, "Array");
    if (reply._tag === "Array") {
      assert.deepEqual(reply.values.slice(0, 2), [
        { _tag: "BlobString", value: bytes("length") },
        { _tag: "Integer", value: 1n },
      ]);
      assert.ok(
        !reply.values.some(
          (value) =>
            value._tag === "BlobString" &&
            new TextDecoder().decode(value.value) === "radix-tree-keys",
        ),
      );
    }
    record("streams.strict-info-missing-metadata", "XINFO STREAM", "different");
  } else
    yield* check("streams.info", C.xinfoStream(key), (value) => assert.equal(value.length, 1n));
  yield* check("streams.setid", C.xgroupSetid(key, "g", "0"), undefined);
  yield* check("streams.consumer-delete", C.xgroupDelconsumer(key, "g", "never-active"), 0n);
  yield* check("streams.group-destroy", C.xgroupDestroy(key, "g"), true);
  yield* check("streams.trim", C.xtrim(key, { by: "MAXLEN", threshold: 0 }), 1n);

  // Unsupported profiles still send valid typed commands and must reject them, rather than being skipped.
  if (!policy.unavailable.has("XADD")) yield* redis.xadd(key, "2-0", [["f", "v"]]);
  yield* check("streams.delete", C.xdel(key, ["2-0"]), 1n);
});
