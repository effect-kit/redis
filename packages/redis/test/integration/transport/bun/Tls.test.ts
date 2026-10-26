import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { loopback } from "#test/support/networking/SocketServer";
import { runBun } from "#test/support/runtime/bun/Process";
import { certificates } from "#test/support/tls/Certificates";
import { tlsServer } from "#test/support/tls/TlsServer";

it.live(
  "BUN-TLS: CA trust, peer identity, SNI and explicit insecure policy",
  () =>
    Effect.gen(function* () {
      const identity = yield* certificates();
      const peer = yield* tlsServer(identity);
      const endpoint = { host: "127.0.0.1", port: peer.port };

      yield* runBun({
        scenario: "transport",
        operation: "echo",
        config: { endpoint: { ...endpoint, tls: { ca: identity.ca, serverName: "redis.test" } } },
      });
      expect(peer.names).toContain("redis.test");

      for (const tls of [
        { serverName: "redis.test" },
        { ca: identity.ca, serverName: "wrong.test" },
        { ca: identity.ca },
      ]) {
        const receipt = yield* runBun({
          scenario: "transport",
          operation: "open-error",
          config: { endpoint: { ...endpoint, tls } },
        });
        expect(receipt.checks).toContain("open-failure");
      }

      yield* runBun({
        scenario: "transport",
        operation: "echo",
        config: { endpoint: { ...endpoint, tls: { rejectUnauthorized: false } } },
      });
    }),
  30_000,
);

it.live("BUN-TLS: configured client certificate completes mutual authentication", () =>
  Effect.gen(function* () {
    const identity = yield* certificates();
    const peer = yield* tlsServer(identity, true);

    yield* runBun({
      scenario: "transport",
      operation: "echo",
      config: {
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
      },
    });

    expect(peer.authorized).toEqual([true]);
  }),
);

it.live("BUN-TLS: readiness deadlines and interruption await stalled-handshake cleanup", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.resume());
    const config = {
      endpoint: { host: "127.0.0.1", port: peer.port, tls: {} },
      connectTimeoutMillis: 50,
    };

    yield* runBun({ scenario: "transport", operation: "open-error", config });
    yield* runBun({ scenario: "transport", operation: "open-cancel", config });

    expect(peer.counts()).toEqual({ accepted: 2, closed: 2 });
  }),
);
