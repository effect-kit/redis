import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Redacted } from "effect";

import { Commands } from "#/index";
import { connect, layer } from "#/node";
import { encodeCommand } from "#/protocol/encode";
import { decodeRedisConfig } from "#/RedisConfig";
import { makeRedisSessions } from "#/sessions/RedisSessions";
import { Transport } from "#/transport/Transport";
import { bytes } from "#test/support/commands/CoreCase";
import { exchange } from "#test/support/networking/Exchange";
import { faultProxy } from "#test/support/networking/FaultProxy";
import { dockerServer } from "#test/support/servers/DockerServer";
import { selectedEngine, serverTargets } from "#test/support/servers/Targets";
import type { ServerTarget } from "#test/support/servers/Targets";

const targets = serverTargets.filter(
  (target) =>
    ["redis", "valkey"].includes(target.fixture) &&
    (selectedEngine === "all" || target.product === selectedEngine),
);
const cases = targets.flatMap((target) =>
  ["resp2", "resp3"].map((protocol) => ({ target, protocol })),
);

const lossyBackend = Effect.fnUntraced(function* (
  target: ServerTarget,
  protocol: string,
  trigger: readonly [string, ...string[]],
) {
  const server = yield* dockerServer(target);
  const proxy = yield* faultProxy(server.port, { fragmentBytes: 1 });
  const config = yield* decodeRedisConfig({
    endpoint: { host: "127.0.0.1", port: proxy.port },
    protocol,
    limits: { maxInFlightCommands: 1 },
  });
  const native = yield* Transport.pipe(Effect.provide(layer));
  const signal = yield* Deferred.make<Effect.Effect<void>>();
  const frame = yield* Effect.fromResult(encodeCommand(trigger));
  let armed = true;

  // Inject failure at the real byte boundary; production admission, writer and reader remain active.
  const faulty = Layer.succeed(Transport, {
    open: (configuration) =>
      native.open(configuration).pipe(
        Effect.map((connection) => ({
          ...connection,
          write: (request: Uint8Array) =>
            Effect.gen(function* () {
              if (
                armed &&
                request.length === frame.length &&
                request.every((byte, index) => byte === frame[index])
              ) {
                armed = false;
                const held = yield* proxy.holdReplies;
                yield* Deferred.succeed(signal, held);
              }
              yield* connection.write(request);
            }),
        })),
      ),
  });
  const sessions = yield* makeRedisSessions(config).pipe(Effect.provide(faulty));
  const oracle = yield* connect(
    yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: server.port } }),
  );

  return { sessions, oracle, proxy, held: Deferred.await(signal).pipe(Effect.flatten) };
});

it.live.each(cases)(
  "SESSION-LOSS: $target.fixture $protocol pipeline mutation is never replayed",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const key = `effect-redis:pipeline-loss:${randomUUID()}`;
      const { sessions, oracle, proxy, held } = yield* lossyBackend(target, protocol, [
        "INCR",
        key,
      ]);
      const request = yield* Effect.forkChild(
        Effect.flip(
          sessions.pipeline([
            Commands.incr(key),
            Commands.incr(`${key}:b`),
            Commands.incr(`${key}:c`),
          ]),
        ),
      );
      yield* held;
      expect(yield* exchange(oracle, ["GET", key])).toEqual({
        _tag: "BlobString",
        value: bytes("1"),
      });
      yield* proxy.cut;
      const failure = yield* Fiber.join(request);
      if (failure._tag !== "BatchError") return yield* Effect.die("Missing pipeline loss evidence");
      expect(Redacted.value(failure.outcomes)).toMatchObject([
        { _tag: "Unknown", index: 0 },
        { _tag: "Unsent", index: 1 },
        { _tag: "Unsent", index: 2 },
      ]);
      expect(yield* exchange(oracle, ["GET", `${key}:b`])).toMatchObject({ _tag: "Null" });

      yield* proxy.releaseReplies;
      yield* sessions.withSession((session) => session.ping());
      expect(yield* exchange(oracle, ["GET", key])).toEqual({
        _tag: "BlobString",
        value: bytes("1"),
      });
    }),
);

it.live.each(cases)(
  "SESSION-LOSS: $target.fixture $protocol lost EXEC reply preserves actual execution uncertainty",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const key = `effect-redis:exec-loss:${randomUUID()}`;
      const { sessions, oracle, proxy, held } = yield* lossyBackend(target, protocol, ["EXEC"]);
      const request = yield* Effect.forkChild(
        Effect.flip(sessions.transaction([Commands.incr(key)])),
      );
      yield* held;
      expect(yield* exchange(oracle, ["GET", key])).toEqual({
        _tag: "BlobString",
        value: bytes("1"),
      });
      yield* proxy.cut;
      expect(yield* Fiber.join(request)).toMatchObject({
        _tag: "BatchError",
        phase: "transaction-exec",
        execution: "unknown",
      });

      yield* proxy.releaseReplies;
      yield* sessions.withSession((session) => session.ping());
      expect(yield* exchange(oracle, ["GET", key])).toEqual({
        _tag: "BlobString",
        value: bytes("1"),
      });
    }),
);
