import assert from "node:assert/strict";

import { Effect, Option, Result } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

export const scripting = Effect.fnUntraced(function* ({
  redis,
  sessions,
  prefix,
  check,
  rejected,
  record,
  policy,
}: Client) {
  const C = core.Commands;
  const R = core.Reply;
  const key = `${prefix}:script`;
  const source = "return redis.call('INCR', KEYS[1])";

  if (policy.engine === "garnet") {
    yield* rejected(
      "scripts.disabled-profile",
      C.evalScript("return 1", { keys: [] }, R.integer),
      /(?:disabled|not enabled|--lua)/i,
    );
  } else {
    yield* check(
      "scripts.eval-binary",
      C.evalScript("return ARGV[1]", { keys: [], args: [new Uint8Array([0, 255])] }, R.blob),
      new Uint8Array([0, 255]),
    );
    const digest = yield* redis.scriptLoad(source);
    assert.match(digest, /^[0-9a-f]{40}$/);
    record("scripts.load", "SCRIPT LOAD");
    yield* check("scripts.exists", C.scriptExists([digest]), [true]);
    yield* check("scripts.evalsha", C.evalSha(digest, { keys: [key] }, R.integer), 1n);
    yield* check("scripts.read-only", C.evalReadOnly("return 8", { keys: [] }, R.integer), 8n);
    const readDigest = yield* redis.scriptLoad("return 8");
    yield* check(
      "scripts.sha-read-only",
      C.evalShaReadOnly(readDigest, { keys: [] }, R.integer),
      8n,
    );
    yield* check("scripts.flush", C.scriptFlush(), undefined);

    const pipeline = yield* sessions.pipeline([
      C.evalSha(digest, { keys: [key] }, R.integer),
      C.incr(key),
    ]);
    assert.ok(Result.isFailure(pipeline[0]) && pipeline[0].failure instanceof core.ServerError);
    assert.equal(pipeline[0].failure.code, "NOSCRIPT");
    assert.deepEqual(pipeline[1], Result.succeed(2n));
    assert.deepEqual(yield* redis.get(key), Option.some("2"));
    record("scripts.noscript-does-not-replay-siblings", "EVALSHA");

    const failure = yield* Effect.flip(
      redis.evalScript(
        "redis.call('INCR', KEYS[1]); error('conformance failure')",
        { keys: [key] },
        R.integer,
      ),
    );
    assert.ok(failure instanceof core.ServerError);
    assert.deepEqual(yield* redis.get(key), Option.some("3"));
    record("scripts.error-after-mutation-no-replay", "EVAL");
  }

  const code =
    policy.engine === "kvrocks"
      ? "#!lua name=effect_conformance\nredis.register_function('effect_read', function(keys,args) return args[1] end)"
      : "#!lua name=effect_conformance\nredis.register_function{function_name='effect_read', callback=function(keys,args) return args[1] end, flags={'no-writes'}}";
  yield* check(
    "functions.load",
    C.functionLoad(code),
    policy.engine === "kvrocks" ? "" : "effect_conformance",
    policy.engine === "kvrocks" ? "different" : "passed",
  );
  yield* check(
    "functions.call",
    C.fcall("effect_read", { keys: [], args: ["value"] }, R.text),
    "value",
  );
  yield* check(
    "functions.call-ro",
    C.fcallReadOnly("effect_read", { keys: [], args: ["ro"] }, R.text),
    "ro",
  );
  yield* check("functions.list", C.functionList({ withCode: true }), (values) =>
    assert.equal(values.length, 1),
  );
  yield* check("functions.stats", C.functionStats(), (values) => assert.ok(values.length > 0));
  yield* check("functions.delete", C.functionDelete("effect_conformance"), undefined);
});
