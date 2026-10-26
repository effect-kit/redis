import { Duration, Effect, Fiber, Option, Stream } from "effect";

import { core, native, ensure } from "#test/runners/bun/Runtime";
import { gatedTransport } from "#test/support/networking/GatedTransport";
import type { RuntimeInput } from "#test/support/runtime/bun/Input";

export const uncertainty = Effect.fnUntraced(function* (
  input: Extract<RuntimeInput, { scenario: "uncertainty" }>,
) {
  const config = yield* core.decodeRedisConfig(input.config);
  const observer = core.makeRedis(core.makeExecutor(yield* core.makeConnection(config)));
  const options = { count: 1, block: { blockFor: Duration.seconds(1) } };
  const prepared =
    input.operation === "group"
      ? yield* core.Commands.xreadgroup("workers", "bun", [[input.key, ">"]], options).prepare
      : undefined;
  const trigger = yield* Effect.fromResult(
    core.encodeCommand(
      input.operation === "mutation"
        ? ["INCR", input.key]
        : input.operation === "exec"
          ? ["EXEC"]
          : prepared === undefined
            ? ["INVALID"]
            : prepared.tokens,
    ),
  );
  const gate = yield* gatedTransport(
    core.Transport,
    trigger,
    new core.TransportError({ stage: "read", reason: "io" }),
  ).pipe(Effect.provide(native.layer));

  if (input.operation === "mutation") {
    const connection = yield* core.makeConnection(config).pipe(Effect.provide(gate.layer));
    const redis = core.makeRedis(core.makeExecutor(connection));
    const request = yield* redis.incr(input.key).pipe(Effect.flip, Effect.forkChild);
    yield* gate.arrived;
    yield* gate.cut;
    const failure = yield* Fiber.join(request);
    ensure(
      failure._tag === "ConnectionError" && failure.delivery === "possibly-written",
      "Lost mutation did not retain uncertainty",
    );
    const current = yield* redis.get(input.key);
    ensure(Option.isSome(current) && current.value === "1", "Mutation replayed during recovery");
  } else {
    const sessions = yield* core.makeRedisSessions(config).pipe(Effect.provide(gate.layer));
    if (input.operation === "exec") {
      const request = yield* sessions
        .transaction([core.Commands.incr(input.key)])
        .pipe(Effect.flip, Effect.forkChild);
      yield* gate.arrived;
      yield* gate.cut;
      const failure = yield* Fiber.join(request);
      ensure(
        failure._tag === "BatchError" &&
          failure.execution === "unknown" &&
          failure.phase === "transaction-exec",
        "Lost EXEC did not retain batch uncertainty",
      );
      const current = yield* observer.get(input.key);
      ensure(
        Option.isSome(current) && current.value === "1",
        "EXEC replayed after a committed reply was lost",
      );
    } else {
      yield* observer.xgroupCreate(input.key, "workers", "0", { mkstream: true });
      const id = yield* observer.xadd(input.key, "*", [["field", "value"]]);
      const streams = core.makeRedisStreams(observer, sessions);
      const request = yield* streams
        .readGroup("workers", "bun", [input.key], options)
        .pipe(Stream.runDrain, Effect.flip, Effect.forkChild);
      yield* gate.arrived;
      ensure(
        (yield* observer.xpending(input.key, "workers")).count === 1n,
        "Fixture group delivery was not committed",
      );
      yield* gate.cut;
      const failure = yield* Fiber.join(request);
      ensure(
        failure._tag === "ConnectionError" && failure.delivery === "possibly-written",
        "Lost group delivery did not retain uncertainty",
      );
      const pending = yield* observer.xpendingEntries(input.key, "workers", {
        start: "-",
        end: "+",
        count: 1,
      });
      ensure(
        pending[0]?.id === id && pending[0].deliveries === 1n,
        "Group delivery replayed or was acknowledged",
      );
    }
  }

  return [
    "actual-bun-socket",
    "server-reply-observed",
    `lost-${input.operation}`,
    "unknown-outcome",
    "no-replay",
  ];
});
