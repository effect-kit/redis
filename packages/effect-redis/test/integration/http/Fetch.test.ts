import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option, Redacted } from "effect";
import { FetchHttpClient } from "effect/http";

import { makeUpstash } from "#/upstash";
import { certificates } from "#test/support/tls/Certificates";
import { httpServer, requestBody } from "#test/support/upstash/HttpServer";

it.live("HTTP-FETCH: binary final bodies and fragmented binary replies use actual fetch", () =>
  Effect.gen(function* () {
    const received = yield* Deferred.make<Uint8Array>();
    const fixture = yield* httpServer((request, response) => {
      return requestBody(request)
        .then((body) => {
          Deferred.doneUnsafe(received, Effect.succeed(new Uint8Array(body)));
          response.writeHead(200, { "content-type": "application/octet-stream" });
          for (const byte of [36, 50, 13, 10, 0, 255, 13, 10]) response.write(Buffer.from([byte]));
          response.end();
          return undefined;
        })
        .catch(() => {
          response.destroy();
        });
    });
    const client = yield* makeUpstash({
      url: fixture.url,
      token: Redacted.make("fixture"),
      allowInsecureLocalhost: true,
    }).pipe(Effect.provide(FetchHttpClient.layer));
    const bytes = new Uint8Array([0, 255]);

    const value = yield* client.redis.pingMessage(bytes);
    expect(value).toEqual(bytes);
    expect(yield* Deferred.await(received)).toEqual(bytes);
  }),
);

it.live("HTTP-FETCH: redirects never forward bearer credentials or retry a mutation", () =>
  Effect.gen(function* () {
    let redirected = 0;
    let submitted = 0;
    const destination = yield* httpServer((_request, response) => {
      redirected++;
      response.end();
    });
    const source = yield* httpServer((_request, response) => {
      submitted++;
      response.writeHead(307, { location: destination.url });
      response.end();
    });
    const client = yield* makeUpstash({
      url: source.url,
      token: Redacted.make("fixture"),
      allowInsecureLocalhost: true,
    }).pipe(Effect.provide(FetchHttpClient.layer));

    expect(yield* Effect.flip(client.redis.incr("key"))).toMatchObject({
      _tag: "UpstashError",
      reason: "status",
      status: 307,
    });
    expect(submitted).toBe(1);
    expect(redirected).toBe(0);
  }),
);

it.live(
  "HTTP-FETCH: an interrupted body read aborts the native request and releases capacity",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const closed = yield* Deferred.make<void>();
      let requests = 0;
      const fixture = yield* httpServer((request, response) => {
        requests++;
        response.writeHead(200, { "content-type": "application/octet-stream" });
        if (requests > 1) {
          response.end("$-1\r\n");
          return;
        }
        response.write("$100\r\n");
        Deferred.doneUnsafe(started, Effect.void);
        request.socket.once("close", () => Deferred.doneUnsafe(closed, Effect.void));
      });
      const client = yield* makeUpstash({
        url: fixture.url,
        token: Redacted.make("fixture"),
        allowInsecureLocalhost: true,
        maxConcurrentRequests: 1,
      }).pipe(Effect.provide(FetchHttpClient.layer));
      const reading = yield* client.redis.getBytes("key").pipe(Effect.forkChild);
      yield* Deferred.await(started);

      yield* Fiber.interrupt(reading);
      yield* Deferred.await(closed);
      expect(yield* client.redis.getBytes("other")).toEqual(Option.none());
      expect(requests).toBe(2);
      expect(fixture.sockets.size).toBeLessThanOrEqual(1);
    }),
);

it.live("HTTP-FETCH: oversized and truncated responses fail without mutation replay", () =>
  Effect.gen(function* () {
    let requests = 0;
    const fixture = yield* httpServer((_request, response) => {
      requests++;
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(`$100\r\n${"x".repeat(100)}\r\n`);
    });

    const client = yield* makeUpstash({
      url: fixture.url,
      token: Redacted.make("fixture"),
      allowInsecureLocalhost: true,
      maxResponseBytes: 32,
    }).pipe(Effect.provide(FetchHttpClient.layer));

    expect(yield* Effect.flip(client.redis.getBytes("key"))).toMatchObject({ reason: "limit" });
    expect(requests).toBe(1);
  }),
);

it.live("HTTP-FETCH: HTTPS rejects untrusted identities before an HTTP command is received", () =>
  Effect.gen(function* () {
    let received = 0;
    const fixture = yield* httpServer(
      (_request, response) => {
        received++;
        response.end();
      },
      yield* certificates(),
    );
    const client = yield* makeUpstash({
      url: fixture.url,
      token: Redacted.make("fixture"),
    }).pipe(Effect.provide(FetchHttpClient.layer));

    expect(yield* Effect.flip(client.redis.incr("key"))).toMatchObject({
      _tag: "UpstashError",
      reason: "network",
    });
    expect(received).toBe(0);
  }),
);
