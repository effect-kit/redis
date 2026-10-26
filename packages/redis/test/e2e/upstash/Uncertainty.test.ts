import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { FetchHttpClient } from "effect/http";

import { Commands } from "#/index";
import { connect } from "#/node";
import { makeUpstash } from "#/upstash";
import { exchange } from "#test/support/networking/Exchange";
import { httpTargets, upstashFixture } from "#test/support/upstash/Fixture";
import { httpServer, requestBody } from "#test/support/upstash/HttpServer";

it.live.each(httpTargets)(
  "HTTP-LOSS: $fixture committed mutation, EXEC and group delivery are never replayed",
  (target) =>
    Effect.gen(function* () {
      const fixture = yield* upstashFixture(target);
      const oracle = yield* connect(fixture.nativeConfig);
      const direct = yield* makeUpstash(fixture.input).pipe(Effect.provide(FetchHttpClient.layer));
      let dispatched = 0;
      const fault = yield* httpServer((request, response, signal) => {
        return (async () => {
          const body = await requestBody(request);
          const upstream = await fetch(fixture.input.url + (request.url ?? "/"), {
            method: "POST",
            body,
            headers: {
              authorization: `Bearer ${Redacted.value(fixture.input.token)}`,
              "content-type": request.headers["content-type"] ?? "application/json",
              ...(request.headers["upstash-response-format"] === undefined
                ? { "upstash-encoding": "base64" }
                : { "upstash-response-format": "resp2" }),
            },
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          });
          await upstream.arrayBuffer();
          if (!upstream.ok) throw new Error("Expected a committed fixture request");
          dispatched++;
          // Only cut after the real proxy has returned the backend's committed reply.
          response.destroy();
        })().catch(() => {
          response.destroy();
        });
      });
      const client = yield* makeUpstash({ ...fixture.input, url: fault.url }).pipe(
        Effect.provide(FetchHttpClient.layer),
      );
      const prefix = `http-loss:${randomUUID()}`;

      expect(yield* Effect.flip(client.redis.incr(`${prefix}:mutation`))).toMatchObject({
        reason: "network",
        delivery: "unknown",
      });
      expect(yield* exchange(oracle, ["GET", `${prefix}:mutation`])).toEqual({
        _tag: "BlobString",
        value: new TextEncoder().encode("1"),
      });

      const transaction = yield* Effect.flip(
        client.batches.transaction([Commands.incr(`${prefix}:transaction`)]),
      );
      expect(transaction).toMatchObject({ _tag: "BatchError", execution: "unknown" });
      expect(yield* exchange(oracle, ["GET", `${prefix}:transaction`])).toEqual({
        _tag: "BlobString",
        value: new TextEncoder().encode("1"),
      });

      yield* direct.redis.xadd(`${prefix}:stream`, "*", [["field", "value"]]);
      yield* direct.redis.xgroupCreate(`${prefix}:stream`, "group", "0");
      expect(
        yield* Effect.flip(
          client.redis.xreadgroup("group", "consumer", [[`${prefix}:stream`, ">"]]),
        ),
      ).toMatchObject({ delivery: "unknown" });
      const pending = yield* exchange(oracle, ["XPENDING", `${prefix}:stream`, "group"]);
      expect(pending._tag === "Array" ? pending.values[0] : undefined).toEqual({
        _tag: "Integer",
        value: 1n,
      });
      expect(dispatched).toBe(3);
    }),
);
