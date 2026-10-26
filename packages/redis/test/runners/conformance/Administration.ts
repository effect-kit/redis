import assert from "node:assert/strict";

import { Effect, Option, Redacted } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

export const administration = Effect.fnUntraced(function* ({
  prefix,
  redis,
  sessions,
  check,
  record,
  policy,
  raw,
}: Client) {
  const C = core.Commands;
  const key = `${prefix}:admin`;
  yield* redis.set(key, "value");

  if (policy.engine === "kvrocks") {
    yield* check("admin.dbsize-cached", C.dbsize(), 0n, "different");
    assert.equal(yield* redis.exists([key]), 1n);
    assert.deepEqual(yield* raw(["DBSIZE", "SCAN"]), {
      _tag: "SimpleString",
      value: new TextEncoder().encode("OK"),
    });
    let refreshed = 0n;
    for (let attempt = 0; attempt < 100; attempt++) {
      refreshed = yield* sessions.withSession((session) => session.execute(C.dbsize()));
      if (refreshed > 0n) break;
      yield* Effect.sleep(10);
    }
    assert.ok(refreshed > 0n);
    record("admin.dbsize-explicit-asynchronous-scan", "DBSIZE SCAN", "different");
  } else yield* check("admin.dbsize", C.dbsize(), (count) => assert.ok(count > 0n));
  yield* check("admin.time", C.time(), ([seconds, micros]) =>
    assert.ok(seconds > 0n && micros >= 0n && micros < 1000000n),
  );
  yield* check("admin.info-server", C.info(["server"]), (info) =>
    assert.ok(info.sections.length > 0),
  );
  yield* check("admin.command-count", C.commandCount(), (count) => assert.ok(count > 0n));
  yield* check("admin.client-id", C.clientId(), (id) => assert.ok(id > 0n));
  yield* check("admin.client-list", C.clientList(), (report) =>
    assert.match(Redacted.value(report), /id=/),
  );
  const configuredPort = ["dragonfly", "garnet"].includes(policy.engine)
    ? []
    : [
        [
          new TextEncoder().encode("port"),
          new TextEncoder().encode(policy.engine === "kvrocks" ? "6666" : "6379"),
        ],
      ];
  yield* check(
    "admin.config-port",
    C.configGet(["port"]),
    (report) => assert.deepEqual(Redacted.value(report), configuredPort),
    ["dragonfly", "garnet"].includes(policy.engine) ? "different" : "passed",
  );
  yield* check("admin.module-list", C.moduleList(), (modules) => assert.ok(Array.isArray(modules)));
  yield* check("admin.role", C.role(), (role) => assert.ok(role.length > 0));

  yield* sessions.withSession((session) =>
    Effect.gen(function* () {
      yield* session.execute(C.clientSetName("effect-conformance"));
      assert.deepEqual(
        yield* session.execute(C.clientGetName()),
        Option.some("effect-conformance"),
      );
      yield* session.execute(C.clientSetName(""));
    }),
  );
  record("admin.leased-client-name", "CLIENT SETNAME");
});
