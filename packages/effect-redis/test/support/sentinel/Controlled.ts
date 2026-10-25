import { Effect, Fiber, Layer, Queue } from "effect";

import { TransportError } from "#/errors/TransportError";
import { decodeSentinelConfig } from "#/sentinel/Config";
import type { SentinelOptions } from "#/sentinel/Options";
import { makeRedisSentinel } from "#/sentinel/RedisSentinel";
import { Transport } from "#/transport/Transport";
import { sent } from "#test/support/connection/Controlled";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

export const primaryRole = "*3\r\n$6\r\nmaster\r\n:0\r\n*0\r\n";
export const replicaRole = "*5\r\n$5\r\nslave\r\n$1\r\na\r\n:6379\r\n$9\r\nconnected\r\n:0\r\n";
export const addressReply = (host = "a") => `*2\r\n$${host.length}\r\n${host}\r\n$4\r\n6379\r\n`;

type Physical = {
  readonly host: string;
  readonly fixture: Effect.Success<ReturnType<typeof makeControlledTransport>>;
};

/** Each test supplies individual physical connections and exact wire exchanges, never a simulated Redis server. */
export const sentinelTransport = Effect.fnUntraced(function* () {
  const connections = yield* Queue.bounded<Physical>(64);
  let acquired = 0;
  const layer = Layer.succeed(Transport, {
    open: (config) =>
      Effect.gen(function* () {
        if (config.endpoint._tag !== "Tcp")
          return yield* new TransportError({ stage: "open", reason: "unavailable" });
        const fixture = yield* makeControlledTransport();
        const transport = yield* Transport.pipe(Effect.provide(fixture.layer));
        acquired++;
        yield* Queue.offer(connections, { host: config.endpoint.host, fixture });
        return yield* transport.open(config);
      }),
  });
  const next = Queue.take(connections);
  const discovery = Effect.fnUntraced(function* (host = "a") {
    const control = yield* next;
    yield* sent(
      control.fixture,
      ["SENTINEL", "GET-MASTER-ADDR-BY-NAME", "cache"],
      addressReply(host),
    );
    const probe = yield* next;
    yield* sent(probe.fixture, ["ROLE"], primaryRole);
    return { control, probe };
  });
  const data = Effect.fnUntraced(function* (host = "a") {
    yield* discovery(host);
    const physical = yield* next;
    yield* sent(physical.fixture, ["ROLE"], primaryRole);
    return physical;
  });

  return { layer, next, discovery, data, acquired: () => acquired };
});

export const sentinelControlled = Effect.fnUntraced(function* (options: SentinelOptions = {}) {
  const fixture = yield* sentinelTransport();
  const config = yield* decodeSentinelConfig({
    serviceName: "cache",
    sentinels: [{ endpoint: { host: "s1" }, protocol: "resp2" }],
    data: { protocol: "resp2", connectTimeoutMillis: 500, commandTimeoutMillis: 1000 },
  });
  const opening = yield* Effect.forkChild(
    makeRedisSentinel(config, { discoveryAttempts: 1, ...options }).pipe(
      Effect.provide(fixture.layer),
    ),
  );
  yield* fixture
    .discovery()
    .pipe(Effect.raceFirst(Fiber.join(opening).pipe(Effect.andThen(Effect.never))));
  const client = yield* Fiber.join(opening);

  return { ...fixture, client, config };
});
