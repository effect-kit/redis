import { Effect, Option, Result } from "effect";

import { core, ensure, native } from "#test/runners/bun/Runtime";

export const pipelinedTransactions = Effect.fnUntraced(function* (
  input: unknown,
  engine: "redis" | "valkey",
) {
  const config = yield* core.decodeRedisConfig(input);
  if (config.endpoint._tag !== "Tcp" || config.endpoint.tls !== undefined)
    return yield* Effect.fail(new Error("Profiled transaction fixture requires plain TCP"));

  const endpoint = { host: config.endpoint.host, port: config.endpoint.port };
  const key = `bun:pipelined:${crypto.randomUUID()}`;

  return yield* Effect.gen(function* () {
    const redis = yield* core.Redis;
    const sessions = yield* core.RedisSessions;
    const committed = yield* sessions.transaction([
      core.Commands.incr(key),
      core.Commands.get(key),
    ]);
    ensure(
      committed._tag === "Committed" &&
        Result.isSuccess(committed.results[0]) &&
        committed.results[0].success === 1n,
      "Transaction did not commit",
    );

    const rejected = yield* Effect.flip(
      sessions.transaction([
        core.Commands.incr(key),
        core.Commands.raw(["INCR", key, "extra"], {
          execution: "ordinary",
          routing: { _tag: "Keys", keys: [{ index: 1, access: "read-write" }] },
        }),
      ]),
    );
    ensure(
      rejected._tag === "TransactionError" && rejected.execution === "not-executed",
      "Queue rejection did not abort",
    );
    const current = yield* redis.get(key);
    ensure(
      Option.isSome(current) && current.value === "1",
      "An aborted transaction changed its counter",
    );

    const conflict = yield* sessions.watch([key], (session) =>
      redis
        .incr(key)
        .pipe(Effect.andThen(session.transaction([core.Commands.set(key, "unexpected")]))),
    );
    ensure(conflict._tag === "Conflict", "WATCH conflict was lost");
    yield* sessions.withSession((session) => session.ping());
    const plan = yield* redis.compile([core.Commands.incr(key), core.Commands.get(key)]);
    const values = yield* plan.execute();
    ensure(
      values[0] === 3n && Option.isSome(values[1]) && values[1].value === "3",
      "Compiled values changed",
    );

    return [
      "profiled-transaction",
      "queue-abort",
      "watch-conflict",
      "lease-reuse",
      "direct-values",
    ];
  }).pipe(
    Effect.provide(
      native.RedisBun.layer({
        endpoint,
        protocol: config.protocol,
        ...(config.credentials === undefined ? {} : { credentials: config.credentials }),
        profile: engine === "redis" ? core.RedisProfiles.redis() : core.RedisProfiles.valkey(),
      }),
    ),
  );
});
