import assert from "node:assert/strict";

import { Context, Effect, Redacted, Schema } from "effect";

import type { Command } from "#/command/Command";
import type { Redis, RedisSessions, RedisPubSub } from "#/index";
import type { RedisCommand } from "#/protocol/encode";
import { core, connect } from "#test/runners/conformance/Runtime";
import { exchange } from "#test/runners/conformance/Wire";
import type { Input, Observation } from "#test/support/conformance/Contract";
import { expectations } from "#test/support/conformance/expectations/Commands";

export const client = Effect.fnUntraced(function* (input: Input) {
  if (connect === undefined) return yield* Effect.die("Missing runtime adapter");
  const policy = expectations(input.engine, input.version);
  const config = yield* core.decodeRedisConfig(input.config);
  const context = yield* Effect.context<Redis | RedisSessions | RedisPubSub>();
  const redis = Context.get(context, core.Redis);
  const sessions = Context.get(context, core.RedisSessions);
  const pubsub = Context.get(context, core.RedisPubSub);
  const oracle = yield* connect(config);
  const observations: Observation[] = [];
  const prefix = `conformance:${crypto.randomUUID()}`;

  const check = Effect.fnUntraced(function* <A, E>(
    id: string,
    command: Command<A, E>,
    expected: A | ((value: A) => void),
    outcome: Observation["outcome"] = "passed",
  ) {
    const prepared = yield* command.prepare;
    const name = prepared.metadata.name;
    const execute =
      prepared.metadata.execution === "blocking"
        ? sessions.executeBlocking(command)
        : prepared.metadata.execution === "exclusive"
          ? sessions.withSession((session) => session.execute(command))
          : redis.execute(command);
    if (policy.unavailable.has(name)) {
      const result = yield* Effect.result(execute);
      assert.equal(result._tag, "Failure", `${id}: unexpectedly accepted`);
      if (result._tag !== "Failure") return yield* Effect.die(`Unexpected success: ${id}`);
      const error = result.failure;
      assert.ok(error instanceof core.ServerError, `${id}: expected a server rejection`);
      const reply = Schema.decodeUnknownSync(
        Schema.Struct({
          _tag: Schema.Literals(["SimpleError", "BlobError"]),
          value: Schema.Uint8Array,
        }),
      )(Redacted.value(error.reply));
      assert.match(
        new TextDecoder().decode(reply.value),
        policy.engine === "dragonfly" && name.startsWith("FUNCTION ")
          ? /^ERR (?:wrong number of arguments for 'function' command|Unknown subcommand or wrong number of arguments)/
          : /^ERR.*(?:unknown|unsupported|not supported|not implemented|no such subcommand)/i,
        id,
      );
      observations.push({ id, command: name, outcome: "expected-unsupported" });
      return;
    }

    const value = yield* execute.pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          process.stderr.write(
            `Scenario ${id}: ${error instanceof core.ServerError ? error.code : "client-error"}\n`,
          );
        }),
      ),
    );
    if (typeof expected === "function") (expected as (value: A) => void)(value);
    else assert.deepEqual(value, expected, id);
    observations.push({ id, command: name, outcome });
  });

  const wrongType = Effect.fnUntraced(function* <A, E>(id: string, command: Command<A, E>) {
    const prepared = yield* command.prepare;
    const result = yield* Effect.result(redis.execute(command));
    assert.equal(result._tag, "Failure", `${id}: unexpectedly accepted`);
    if (result._tag !== "Failure") return yield* Effect.die(`Unexpected success: ${id}`);
    const error = result.failure;
    assert.ok(error instanceof core.ServerError, id);
    // Kvrocks wraps WRONGTYPE inside an ERR response; keep the actual server code intact.
    assert.equal(error.code, policy.engine === "kvrocks" ? "ERR" : "WRONGTYPE", id);
    const reply = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.Uint8Array }))(
      Redacted.value(error.reply),
    );
    assert.match(new TextDecoder().decode(reply.value), /WRONGTYPE/, id);
    observations.push({
      id,
      command: prepared.metadata.name,
      outcome: policy.engine === "kvrocks" ? "different" : "passed",
    });
  });

  const rejected = Effect.fnUntraced(function* <A, E>(
    id: string,
    command: Command<A, E>,
    pattern: RegExp,
  ) {
    const prepared = yield* command.prepare;
    const result = yield* Effect.result(redis.execute(command));
    assert.equal(result._tag, "Failure", `${id}: unexpectedly accepted`);
    if (result._tag !== "Failure") return yield* Effect.die(`Unexpected success: ${id}`);
    const error = result.failure;
    assert.ok(error instanceof core.ServerError, id);
    const reply = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.Uint8Array }))(
      Redacted.value(error.reply),
    );
    assert.match(new TextDecoder().decode(reply.value), pattern, id);
    observations.push({ id, command: prepared.metadata.name, outcome: "expected-unsupported" });
  });

  return {
    redis,
    config,
    sessions,
    pubsub,
    context,
    observations,
    prefix,
    policy,
    protocol: input.protocol,
    check,
    wrongType,
    rejected,
    raw: (tokens: RedisCommand) => exchange(oracle, tokens),
    record: (id: string, command: string, outcome: Observation["outcome"] = "passed") => {
      observations.push({ id, command, outcome });
    },
  };
});

export type Client = Effect.Success<ReturnType<typeof client>>;
