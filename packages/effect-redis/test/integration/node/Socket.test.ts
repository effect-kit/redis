import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Result } from "effect";

import { connect, layer, Transport } from "#/node";
import { decodeRedisConfig } from "#/RedisConfig";
import { loopback } from "#test/support/networking/SocketServer";
import { temporaryDirectory } from "#test/support/servers/TemporaryDirectory";

it.live("SOCKET-01: TCP Layer exchanges owned binary chunks and closes idempotently", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.on("data", (bytes) => socket.write(bytes)));
    const transport = yield* Transport;
    const connection = yield* transport.open(
      yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: peer.port } }),
    );
    const bytes = new Uint8Array([0, 255, 13, 10, 128]);
    yield* connection.write(bytes);
    const reply = yield* connection.read;
    expect(reply).toEqual(bytes);
    expect(reply?.constructor).toBe(Uint8Array);
    yield* connection.close;
    yield* connection.close;
    const result = yield* Effect.result(connection.read);
    expect(Result.isFailure(result) && result.failure.reason).toBe("closed");
  }).pipe(Effect.provide(layer)),
);

it.live("SOCKET-02: Unix socket exchanges bytes", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectory;
    const path = join(directory, "redis.sock");
    yield* loopback((socket) => socket.on("data", (bytes) => socket.write(bytes)), { path });
    const connection = yield* connect(yield* decodeRedisConfig({ endpoint: { path } }));
    yield* connection.write(new Uint8Array([42]));
    expect(yield* connection.read).toEqual(new Uint8Array([42]));
  }),
);

it.live("SOCKET-03: drains bytes before stable EOF and rejects writes after half-close", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.end(new Uint8Array([1, 2, 3])), {
      allowHalfOpen: true,
    });
    const connection = yield* connect(
      yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: peer.port } }),
    );
    expect(yield* connection.read).toEqual(new Uint8Array([1, 2, 3]));
    expect(yield* connection.read).toBeUndefined();
    expect(yield* connection.read).toBeUndefined();
    const result = yield* Effect.result(connection.write(new Uint8Array([4])));
    expect(Result.isFailure(result) && result.failure.reason).toBe("closed");
  }),
);

it.live("SOCKET-04: refused acquisition is a redacted typed open failure", () =>
  Effect.gen(function* () {
    const peer = yield* loopback(() => {});
    yield* peer.close;
    const result = yield* Effect.result(
      connect(yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: peer.port } })),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.stage).toBe("open");
      expect(result.failure.reason).toBe("io");
      expect(JSON.stringify(result.failure)).not.toContain("127.0.0.1");
    }
  }),
);

it.live("SOCKET-05: interrupting a pending reader leaves the socket usable", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.on("data", (bytes) => socket.write(bytes)));
    const connection = yield* connect(
      yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: peer.port } }),
    );
    const reader = yield* Effect.forkChild(connection.read);
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(reader);
    yield* connection.write(new Uint8Array([9]));
    expect(yield* connection.read).toEqual(new Uint8Array([9]));
  }),
);

it.live("SOCKET-06: close wakes a pending reader and future operations", () =>
  Effect.gen(function* () {
    const peer = yield* loopback(() => {});
    const connection = yield* connect(
      yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: peer.port } }),
    );
    const reader = yield* Effect.forkChild(Effect.result(connection.read));
    yield* Effect.yieldNow;
    yield* connection.close;
    const result = yield* Fiber.join(reader);
    expect(Result.isFailure(result) && result.failure.stage).toBe("read");
    const write = yield* Effect.result(connection.write(new Uint8Array([1])));
    expect(Result.isFailure(write) && write.failure.reason).toBe("closed");
  }),
);

it.live(
  "SOCKET-07: scope finalization closes physical connections across repeated acquisition",
  () =>
    Effect.gen(function* () {
      const peer = yield* loopback((socket) => socket.on("data", (bytes) => socket.write(bytes)));
      const config = yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: peer.port } });
      for (let index = 0; index < 12; index++) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* connect(config);
            yield* connection.write(new Uint8Array([index]));
            expect(yield* connection.read).toEqual(new Uint8Array([index]));
          }),
        );
      }
      yield* peer.close;
      expect(peer.sockets.size).toBe(0);
      expect(peer.counts()).toEqual({ accepted: 12, closed: 12 });
    }),
);

it.live("SOCKET-08: oversized writes fail before sending and do not poison the socket", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.on("data", (bytes) => socket.write(bytes)));
    const connection = yield* connect(
      yield* decodeRedisConfig({
        endpoint: { host: "127.0.0.1", port: peer.port },
        limits: { maxInFlightBytes: 8 },
      }),
    );
    const result = yield* Effect.result(connection.write(new Uint8Array(9)));
    expect(Result.isFailure(result) && result.failure.reason).toBe("limit");
    yield* connection.write(new Uint8Array([7]));
    expect(yield* connection.read).toEqual(new Uint8Array([7]));
  }),
);

it.live("SOCKET-09: concurrent readers fail explicitly without stealing the first reply", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.on("data", (bytes) => socket.write(bytes)));
    const connection = yield* connect(
      yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: peer.port } }),
    );
    const pending = yield* Effect.forkChild(connection.read);
    yield* Effect.yieldNow;
    const second = yield* Effect.result(connection.read);
    expect(Result.isFailure(second) && second.failure.reason).toBe("unavailable");
    yield* connection.write(new Uint8Array([11]));
    expect(yield* Fiber.join(pending)).toEqual(new Uint8Array([11]));
  }),
);

it.live("SOCKET-10: native write backpressure resumes after a stalled peer starts reading", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.pause());
    const connection = yield* connect(
      yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: peer.port } }),
    );
    const socket = yield* peer.first;
    const payload = new Uint8Array(16 * 1024 * 1024).fill(37);
    const writer = yield* Effect.forkChild(connection.write(payload));
    yield* Effect.callback<void>((resume) => {
      socket.once("readable", () => resume(Effect.void));
    });
    expect(writer.pollUnsafe()).toBeUndefined();
    const received = yield* Effect.forkChild(
      Effect.callback<number>((resume) => {
        let count = 0;
        socket.on("data", (bytes: Uint8Array) => {
          count += bytes.length;
          if (count === payload.length) resume(Effect.succeed(count));
        });
        socket.resume();
      }),
    );
    yield* Fiber.join(writer);
    expect(yield* Fiber.join(received)).toBe(payload.length);
  }),
);

it.live("SOCKET-11: canceling a possibly partial write retires the physical socket", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.pause());
    const connection = yield* connect(
      yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: peer.port } }),
    );
    const socket = yield* peer.first;
    const writer = yield* Effect.forkChild(connection.write(new Uint8Array(16 * 1024 * 1024)));
    yield* Effect.callback<void>((resume) => {
      socket.once("readable", () => resume(Effect.void));
    });
    expect(writer.pollUnsafe()).toBeUndefined();
    yield* Fiber.interrupt(writer);
    const result = yield* Effect.result(connection.write(new Uint8Array([1])));
    expect(Result.isFailure(result) && result.failure.reason).toBe("closed");
  }),
);

it.live("SOCKET-12: peer reset wakes a blocked writer with a typed failure", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.once("data", () => socket.destroy()));
    const connection = yield* connect(
      yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: peer.port } }),
    );
    const result = yield* Effect.result(connection.write(new Uint8Array(16 * 1024 * 1024)));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.stage).toBe("write");
  }),
);

it.live("SOCKET-30: remote reset also wakes a suspended reader", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.once("data", () => socket.resetAndDestroy()));
    const connection = yield* connect(
      yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: peer.port } }),
    );
    const reader = yield* Effect.forkChild(Effect.result(connection.read));
    yield* Effect.yieldNow;
    yield* connection.write(new Uint8Array([1])).pipe(Effect.result);
    const result = yield* Fiber.join(reader);
    expect(Result.isFailure(result) && result.failure.stage).toBe("read");
    if (Result.isFailure(result)) expect(["io", "closed"]).toContain(result.failure.reason);
  }),
);
