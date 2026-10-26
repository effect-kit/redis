import assert from "node:assert/strict";

import { Duration, Effect, Fiber, Option, Result, Stream } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core, transportLayer } from "#test/runners/conformance/Runtime";
import { gatedTransport } from "#test/support/networking/GatedTransport";

/** Only the reply is withheld: an independent connection proves the real server already executed. */
export const uncertainty = Effect.fnUntraced(function* ({
  redis,
  config,
  prefix,
  record,
  policy,
  check,
}: Client) {
  if (transportLayer === undefined) return yield* Effect.die("Missing native transport Layer");
  const C = core.Commands;
  const key = `${prefix}:unknown:mutation`;
  const trigger = yield* Effect.fromResult(core.encodeCommand(["INCR", key]));
  const gate = yield* gatedTransport(
    core.Transport,
    trigger,
    new core.TransportError({ stage: "read", reason: "io" }),
  ).pipe(Effect.provide(transportLayer));
  const connection = yield* core.makeConnection(config).pipe(Effect.provide(gate.layer));
  const client = core.makeRedis(core.makeExecutor(connection));
  const mutation = yield* client.incr(key).pipe(Effect.flip, Effect.forkChild);
  yield* gate.arrived;
  assert.deepEqual(yield* redis.get(key), Option.some("1"));
  yield* gate.cut;
  const failed = yield* Fiber.join(mutation);
  assert.ok(failed instanceof core.ConnectionError && failed.delivery === "possibly-written");
  assert.deepEqual(yield* client.get(key), Option.some("1"));
  assert.equal((yield* connection.snapshot).unknownOutcomes, 1);
  record("uncertainty.mutation-no-replay-future-generation", "INCR");

  const execKey = `${prefix}:unknown:exec`;
  const execGate = yield* gatedTransport(
    core.Transport,
    yield* Effect.fromResult(core.encodeCommand(["EXEC"])),
    new core.TransportError({ stage: "read", reason: "io" }),
  ).pipe(Effect.provide(transportLayer));
  const sessions = yield* core.makeRedisSessions(config).pipe(Effect.provide(execGate.layer));
  const transaction = yield* sessions
    .transaction([C.incr(execKey)])
    .pipe(Effect.flip, Effect.forkChild);
  yield* execGate.arrived;
  assert.deepEqual(yield* redis.get(execKey), Option.some("1"));
  yield* execGate.cut;
  const execError = yield* Fiber.join(transaction);
  assert.ok(
    execError instanceof core.BatchError &&
      execError.execution === "unknown" &&
      execError.phase === "transaction-exec",
  );
  assert.deepEqual(yield* sessions.pipeline([C.get(execKey)]), [Result.succeed(Option.some("1"))]);
  record("uncertainty.exec-no-replay-clean-next-lease", "EXEC");

  const groupKey = `${prefix}:unknown:group`;
  if (policy.engine === "garnet") {
    yield* check("uncertainty.streams-unavailable", C.xadd(groupKey, "1-0", [["f", "v"]]), "1-0");
    return;
  }
  const options = { count: 1, block: { blockFor: Duration.seconds(1) } };
  const prepared = yield* C.xreadgroup("workers", "consumer", [[groupKey, ">"]], options).prepare;
  const groupGate = yield* gatedTransport(
    core.Transport,
    yield* Effect.fromResult(core.encodeCommand(prepared.tokens)),
    new core.TransportError({ stage: "read", reason: "io" }),
  ).pipe(Effect.provide(transportLayer));
  const groupSessions = yield* core.makeRedisSessions(config).pipe(Effect.provide(groupGate.layer));
  yield* redis.xgroupCreate(groupKey, "workers", "0", { mkstream: true });
  const id = yield* redis.xadd(groupKey, "1-0", [["f", "v"]]);
  const streams = core.makeRedisStreams(redis, groupSessions);
  const reading = yield* streams
    .readGroup("workers", "consumer", [groupKey], options)
    .pipe(Stream.runDrain, Effect.flip, Effect.forkChild);
  yield* groupGate.arrived;
  assert.equal((yield* redis.xpending(groupKey, "workers")).count, 1n);
  yield* groupGate.cut;
  const groupError = yield* Fiber.join(reading);
  assert.ok(
    groupError instanceof core.ConnectionError && groupError.delivery === "possibly-written",
  );
  const pending = yield* redis.xpendingEntries(groupKey, "workers", {
    start: "-",
    end: "+",
    count: 1,
  });
  assert.equal(pending[0]?.id, id);
  assert.equal(pending[0]?.deliveries, 1n);
  record("uncertainty.group-delivery-not-replayed-or-acknowledged", "XREADGROUP");
});
