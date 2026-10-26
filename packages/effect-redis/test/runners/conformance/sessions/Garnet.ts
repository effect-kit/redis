import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

/** This profile explicitly enables Lua and key locking; the default Garnet fixture remains unchanged. */
export const garnetLua = Effect.fnUntraced(function* ({
  redis,
  prefix,
  policy,
  check,
  record,
}: Client) {
  assert.equal(policy.engine, "garnet");
  const script = yield* core.RedisScript.make({
    source: "return redis.call('INCR', KEYS[1])",
    decode: core.Reply.integer,
  });
  const scripts = yield* core.RedisScripts;
  const key = `${prefix}:lua`;

  yield* redis.scriptFlush();
  assert.equal(yield* scripts.execute(script, { keys: [key] }), 1n);
  assert.equal(yield* scripts.execute(script, { keys: [key] }), 2n);
  yield* redis.scriptFlush();
  assert.equal(yield* scripts.execute(script, { keys: [key] }), 3n);
  record("garnet-lua.script-cache-recovery", "EVALSHA");
  yield* check(
    "garnet-lua.binary",
    core.Commands.evalScript(
      "return ARGV[1]",
      { keys: [], args: [new Uint8Array([0, 255])] },
      core.Reply.blob,
    ),
    new Uint8Array([0, 255]),
  );

  const error = yield* Effect.flip(
    redis.evalScript(
      "redis.call('INCR', KEYS[1]); error('conformance failure')",
      { keys: [key] },
      core.Reply.integer,
    ),
  );
  assert.ok(error instanceof core.ServerError);
  assert.deepEqual(yield* redis.get(key), Option.some("4"));
  record("garnet-lua.error-after-mutation-no-replay", "EVAL");
});
