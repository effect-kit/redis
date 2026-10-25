import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Redacted, Result } from "effect";

import { connect } from "#/node";
import { decodeRedisConfig } from "#/RedisConfig";
import { faultProxy } from "#test/support/networking/FaultProxy";
import { loopback } from "#test/support/networking/SocketServer";
import { certificates } from "#test/support/tls/Certificates";
import { tlsServer } from "#test/support/tls/TlsServer";

it.live("SOCKET-13: custom CA, verified server name and SNI complete before byte I/O", () =>
  Effect.gen(function* () {
    const identity = yield* certificates();
    const peer = yield* tlsServer(identity);
    const connection = yield* connect(
      yield* decodeRedisConfig({
        endpoint: {
          host: "127.0.0.1",
          port: peer.port,
          tls: { ca: identity.ca, serverName: "redis.test" },
        },
      }),
    );
    yield* connection.write(new Uint8Array([0, 255, 128]));
    expect(yield* connection.read).toEqual(new Uint8Array([0, 255, 128]));
    expect(peer.names).toEqual(["redis.test"]);
  }),
);

it.live("SOCKET-14: untrusted certificates fail acquisition without insecure fallback", () =>
  Effect.gen(function* () {
    const peer = yield* tlsServer(yield* certificates());
    const result = yield* Effect.result(
      connect(
        yield* decodeRedisConfig({
          endpoint: { host: "127.0.0.1", port: peer.port, tls: { serverName: "redis.test" } },
        }),
      ),
    );
    expect(Result.isFailure(result) && result.failure.stage).toBe("open");
  }),
);

it.live("SOCKET-15: trusted CA does not bypass hostname verification", () =>
  Effect.gen(function* () {
    const identity = yield* certificates();
    const peer = yield* tlsServer(identity);
    const result = yield* Effect.result(
      connect(
        yield* decodeRedisConfig({
          endpoint: {
            host: "127.0.0.1",
            port: peer.port,
            tls: { ca: identity.ca, serverName: "wrong.test" },
          },
        }),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result) && result.failure.cause !== undefined)
      expect(Redacted.value(result.failure.cause)).toHaveProperty(
        "code",
        "ERR_TLS_CERT_ALTNAME_INVALID",
      );
  }),
);

it.live("SOCKET-16: explicit insecure mode works only when requested", () =>
  Effect.gen(function* () {
    const peer = yield* tlsServer(yield* certificates());
    const connection = yield* connect(
      yield* decodeRedisConfig({
        endpoint: { host: "127.0.0.1", port: peer.port, tls: { rejectUnauthorized: false } },
      }),
    );
    yield* connection.write(new Uint8Array([5]));
    expect(yield* connection.read).toEqual(new Uint8Array([5]));
  }),
);

it.live("SOCKET-17: mutual TLS presents the configured client certificate and key", () =>
  Effect.gen(function* () {
    const identity = yield* certificates();
    const peer = yield* tlsServer(identity, true);
    const connection = yield* connect(
      yield* decodeRedisConfig({
        endpoint: {
          host: "127.0.0.1",
          port: peer.port,
          tls: {
            ca: identity.ca,
            serverName: "redis.test",
            certificate: identity.clientCertificate,
            privateKey: Redacted.value(identity.clientKey),
          },
        },
      }),
    );
    yield* connection.write(new Uint8Array([6]));
    expect(yield* connection.read).toEqual(new Uint8Array([6]));
    expect(peer.authorized).toEqual([true]);
  }),
);

it.live("SOCKET-18: required client authentication fails without an identity", () =>
  Effect.gen(function* () {
    const identity = yield* certificates();
    const peer = yield* tlsServer(identity, true);
    const result = yield* Effect.result(
      Effect.gen(function* () {
        const connection = yield* connect(
          yield* decodeRedisConfig({
            endpoint: {
              host: "127.0.0.1",
              port: peer.port,
              tls: { ca: identity.ca, serverName: "redis.test" },
            },
          }),
        );
        yield* connection.write(new Uint8Array([1]));
        return yield* connection.read;
      }),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure._tag).toBe("TransportError");
    expect(peer.authorized).toEqual([]);
  }),
);

it.live("SOCKET-19: TLS establishment deadline retires a stalled handshake", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.resume());
    const result = yield* Effect.result(
      connect(
        yield* decodeRedisConfig({
          endpoint: { host: "127.0.0.1", port: peer.port, tls: {} },
          connectTimeoutMillis: 100,
        }),
      ),
    );
    expect(Result.isFailure(result) && result.failure.reason).toBe("timeout");
  }),
);

it.live("SOCKET-20: canceled TLS acquisition destroys the not-yet-ready socket", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.resume());
    const config = yield* decodeRedisConfig({
      endpoint: { host: "127.0.0.1", port: peer.port, tls: {} },
    });
    const opening = yield* Effect.forkChild(connect(config));
    const socket = yield* peer.first;
    const disconnected = yield* Effect.forkChild(
      Effect.callback<void>((resume) => {
        socket.once("close", () => resume(Effect.void));
      }),
    );
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(opening);
    yield* Fiber.join(disconnected);
    expect(peer.counts()).toEqual({ accepted: 1, closed: 1 });
  }),
);

it.live("SOCKET-27: default DNS server name sends SNI and verifies the hostname", () =>
  Effect.gen(function* () {
    const identity = yield* certificates();
    const peer = yield* tlsServer(identity);
    const connection = yield* connect(
      yield* decodeRedisConfig({
        endpoint: { host: "localhost", port: peer.port, tls: { ca: identity.ca } },
      }),
    );
    yield* connection.write(new Uint8Array([8]));
    expect(yield* connection.read).toEqual(new Uint8Array([8]));
    expect(peer.names).toEqual(["localhost"]);
  }),
);

it.live("SOCKET-28: an IP connection still verifies identity without explicit SNI", () =>
  Effect.gen(function* () {
    const identity = yield* certificates();
    const peer = yield* tlsServer(identity);
    const result = yield* Effect.result(
      connect(
        yield* decodeRedisConfig({
          endpoint: { host: "127.0.0.1", port: peer.port, tls: { ca: identity.ca } },
        }),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result) && result.failure.cause !== undefined)
      expect(Redacted.value(result.failure.cause)).toHaveProperty(
        "code",
        "ERR_TLS_CERT_ALTNAME_INVALID",
      );
  }),
);

it.live("SOCKET-29: invalid identity material fails before opening and stays redacted", () =>
  Effect.gen(function* () {
    const peer = yield* loopback(() => {});
    const secret = "synthetic-private-key-do-not-log";
    const result = yield* Effect.result(
      connect(
        yield* decodeRedisConfig({
          endpoint: {
            host: "127.0.0.1",
            port: peer.port,
            tls: { certificate: "invalid-certificate", privateKey: secret },
          },
        }),
      ),
    );
    expect(Result.isFailure(result) && result.failure.stage).toBe("open");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(peer.counts()).toEqual({ accepted: 0, closed: 0 });
  }),
);

it.live("SOCKET-33: forwarding proxy passes verified TLS without terminating it", () =>
  Effect.gen(function* () {
    const identity = yield* certificates();
    const peer = yield* tlsServer(identity);
    const proxy = yield* faultProxy(peer.port);
    const connection = yield* connect(
      yield* decodeRedisConfig({
        endpoint: {
          host: "127.0.0.1",
          port: proxy.port,
          tls: { ca: identity.ca, serverName: "redis.test" },
        },
      }),
    );
    yield* connection.write(new Uint8Array([19]));
    expect(yield* connection.read).toEqual(new Uint8Array([19]));
    expect(peer.names).toEqual(["redis.test"]);
    yield* proxy.firstReply;
  }),
);
