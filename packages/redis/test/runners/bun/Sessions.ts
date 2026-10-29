import { Duration, Effect, Fiber, Option, Redacted, Result } from "effect";

import { core, ensure, eventually } from "#test/runners/bun/Runtime";

export const sessions = Effect.fnUntraced(function* (input: unknown) {
  const config = yield* core.decodeRedisConfig(input);
  const connection = yield* core.makeConnection(config);
  const redis = core.makeRedis(core.makeExecutor(connection));
  const nativeSessions = yield* core.makeRedisSessions(config);
  const key = `bun:session:${crypto.randomUUID()}`;

  const ordinaryKey = `${key}:ordinary`;
  const plan = yield* redis.compile([
    core.Commands.incr(ordinaryKey),
    core.Commands.get(ordinaryKey),
  ]);
  const compiled = yield* plan.execute();
  ensure(
    compiled[0] === 1n && Option.isSome(compiled[1]) && compiled[1].value === "1",
    "Compiled batch ordering changed",
  );
  const shared = yield* redis.batch([
    core.Commands.incr(ordinaryKey),
    core.Commands.get(ordinaryKey),
  ]);
  ensure(
    shared[0] === 2n && Option.isSome(shared[1]) && shared[1].value === "2",
    "Shared batch ordering changed",
  );

  const pipeline = yield* nativeSessions.pipeline([
    core.Commands.incr(key),
    core.Commands.get(key),
  ]);
  ensure(Result.isSuccess(pipeline[0]) && pipeline[0].success === 1n, "Pipeline ordering changed");
  ensure(
    Result.isSuccess(pipeline[1]) &&
      Option.isSome(pipeline[1].success) &&
      pipeline[1].success.value === "1",
    "Pipeline decoding changed",
  );
  const transaction = yield* nativeSessions.transaction([core.Commands.incr(key)]);
  ensure(
    transaction._tag === "Committed" &&
      Result.isSuccess(transaction.results[0]) &&
      transaction.results[0].success === 2n,
    "Transaction did not commit",
  );

  const conflict = yield* nativeSessions.watch([key], (session) =>
    Effect.gen(function* () {
      yield* session.get(key);
      yield* redis.set(key, "changed");
      return yield* session.transaction([core.Commands.set(key, "unexpected")]);
    }),
  );
  ensure(conflict._tag === "Conflict", "WATCH conflict was lost");
  const ordinary = yield* redis.get(key);
  ensure(Option.isSome(ordinary) && ordinary.value === "changed", "Conflicting write was applied");

  const blocked = yield* nativeSessions
    .blpop([`${key}:blocking`], { blockFor: "forever" })
    .pipe(Effect.forkChild);
  const admin = core.makeRedisAdmin(nativeSessions);
  yield* eventually(
    admin.clientList().pipe(Effect.map((report) => Redacted.value(report).includes("cmd=blpop"))),
    "Native blocking operation never reached server",
  );
  yield* Fiber.interrupt(blocked);
  yield* redis.rpush(`${key}:blocking`, ["after-cancel"]);
  const delivered = yield* nativeSessions.blpop([`${key}:blocking`], {
    blockFor: Duration.millis(100),
  });
  ensure(Option.isSome(delivered), "Blocking capacity was not released");

  return [
    "pipeline",
    "transaction",
    "watch-conflict",
    "server-blocking",
    "cancellation",
    "lease-reuse",
  ];
});
