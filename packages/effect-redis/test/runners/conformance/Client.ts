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
  ) {
    const prepared = yield* command.prepare;
    const name = prepared.metadata.name;
    if (policy.unavailable.has(name)) {
      const error = yield* Effect.flip(redis.execute(command));
      assert.ok(error instanceof core.ServerError, `${id}: expected a server rejection`);
      const reply = Schema.decodeUnknownSync(
        Schema.Struct({
          _tag: Schema.Literals(["SimpleError", "BlobError"]),
          value: Schema.Uint8Array,
        }),
      )(Redacted.value(error.reply));
      assert.match(
        new TextDecoder().decode(reply.value),
        /^ERR.*(?:unknown|unsupported|not supported|not implemented)/i,
        id,
      );
      observations.push({ id, command: name, outcome: "expected-unsupported" });
      return;
    }

    const value = yield* redis.execute(command);
    if (typeof expected === "function") (expected as (value: A) => void)(value);
    else assert.deepEqual(value, expected, id);
    observations.push({ id, command: name, outcome: "passed" });
  });

  return {
    redis,
    sessions,
    pubsub,
    context,
    observations,
    prefix,
    policy,
    check,
    raw: (tokens: RedisCommand) => exchange(oracle, tokens),
    record: (id: string, command: string, outcome: Observation["outcome"] = "passed") => {
      observations.push({ id, command, outcome });
    },
  };
});

export type Client = Effect.Success<ReturnType<typeof client>>;
