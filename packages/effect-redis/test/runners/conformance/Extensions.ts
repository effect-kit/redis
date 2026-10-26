import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

/** Proprietary examples stay caller-owned descriptors/raw commands, with explicit routing and decoders. */
export const extensions = Effect.fnUntraced(function* ({
  redis,
  prefix,
  policy,
  record,
  protocol,
}: Client) {
  const key = `${prefix}:extension`;
  const binary = new Uint8Array([0, 255]);
  const routing = { _tag: "Keys", keys: [{ index: 1, access: "read-write" }] } as const;
  const raw = (tokens: readonly [string, ...Array<string | Uint8Array>]) =>
    redis.execute(core.Commands.raw(tokens, { execution: "ordinary", routing }));

  yield* redis.set(key, binary);
  const custom = core.defineCommand({
    metadata: {
      name: "GET",
      family: "custom",
      execution: "ordinary",
      replay: "never",
      provenance: [{ source: "application-owned", revision: "conformance-v1" }],
      scenarios: ["ENGINE-EXTENSION"],
      availability: [],
    },
    tokens: ["GET", key],
    routing: { _tag: "Keys", keys: [{ index: 1, access: "read" }] },
    decode: core.Reply.optional(core.Reply.blob),
  });
  assert.deepEqual(yield* redis.execute(custom), Option.some(binary));
  record("extensions.custom-decoder", "GET");

  const unknown = yield* raw(["EFFECT_REDIS_CONFORMANCE_UNKNOWN", key]);
  assert.equal(unknown._tag, "SimpleError");
  if (unknown._tag === "SimpleError")
    assert.match(new TextDecoder().decode(unknown.value), /unknown command/i);
  yield* redis.ping();
  record("extensions.raw-error-preserved-connection-usable", "RAW");

  if (policy.engine === "keydb") {
    assert.deepEqual(yield* raw(["KEYDB.MEXISTS", key, `${key}:missing`]), {
      _tag: "Array",
      values:
        protocol === "resp3"
          ? [
              { _tag: "Boolean", value: true },
              { _tag: "Boolean", value: false },
            ]
          : [
              { _tag: "Integer", value: 1n },
              { _tag: "Integer", value: 0n },
            ],
    });
    record("extensions.keydb-mexists-raw", "KEYDB.MEXISTS");
  }
  if (policy.engine === "kvrocks") {
    assert.deepEqual(yield* raw(["CAS", key, binary, "replacement"]), {
      _tag: "Integer",
      value: 1n,
    });
    assert.deepEqual(yield* redis.get(key), Option.some("replacement"));
    assert.deepEqual(yield* raw(["CAD", key, "replacement"]), { _tag: "Integer", value: 1n });
    assert.deepEqual(yield* redis.getBytes(key), Option.none());
    record("extensions.kvrocks-cas-raw", "CAS");
    record("extensions.kvrocks-cad-raw", "CAD");
  }
  if (policy.engine === "garnet") {
    // ETag-managed keys never mix ordinary SET/GET with Garnet's ETag commands.
    const etagKey = `${key}:etag`;
    assert.deepEqual(yield* raw(["SETWITHETAG", etagKey, binary]), { _tag: "Integer", value: 1n });
    assert.deepEqual(yield* raw(["GETWITHETAG", etagKey]), {
      _tag: "Array",
      values: [
        { _tag: "Integer", value: 1n },
        { _tag: "BlobString", value: binary },
      ],
    });
    record("extensions.garnet-etag-raw", "GETWITHETAG");
  }
});
