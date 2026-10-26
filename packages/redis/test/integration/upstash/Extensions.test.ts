import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { PayloadCodec } from "#/index";
import { makeUpstash } from "#/upstash";
import { array, blob } from "#test/support/commands/CoreCase";
import { wireValue } from "#test/support/protocol/GeneratedValue";
import { controlledHttp, httpConfig, requestText, resp } from "#test/support/upstash/Controlled";

it.effect("HTTP Search uses its own JSON-token grammar and an explicit document codec", () =>
  Effect.gen(function* () {
    const reply = array(
      array(blob("doc:one"), blob("0.5"), array(array(blob("$"), blob('{"name":"one"}')))),
    );
    const fixture = controlledHttp(() => resp(wireValue(reply, false)));
    const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));
    const codec = PayloadCodec.json(Schema.Struct({ name: Schema.String }));

    const found = yield* client.redis.upstash.searchQueryWith("index", { name: "one" }, codec);
    expect(found).toEqual(
      Option.some([
        { key: new TextEncoder().encode("doc:one"), score: 0.5, value: { name: "one" } },
      ]),
    );
    const request = Option.getOrThrow(Option.fromUndefinedOr(fixture.requests[0]));
    expect(JSON.parse(requestText(request) ?? "null")).toEqual([
      "SEARCH.QUERY",
      "index",
      '{"name":"one"}',
    ]);
  }),
);

it.effect(
  "Search codec failures retain payload errors and do not retry a completed HTTP request",
  () =>
    Effect.gen(function* () {
      const reply = array(
        array(blob("doc:one"), blob("0.5"), array(array(blob("$"), blob('{"name":1}')))),
      );
      const fixture = controlledHttp(() => resp(wireValue(reply, false)));
      const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));

      const decoded = client.redis.upstash.searchQueryWith(
        "index",
        {},
        PayloadCodec.json(Schema.Struct({ name: Schema.String })),
      );
      expect(yield* Effect.flip(decoded)).toMatchObject({ _tag: "PayloadError" });
      expect(fixture.requests).toHaveLength(1);
    }),
);

it.effect(
  "HTTP throttling exposes bounded numeric Retry-After without automatically retrying",
  () =>
    Effect.gen(function* () {
      const fixture = controlledHttp(() =>
        Effect.succeed(new Response("limited", { status: 429, headers: { "retry-after": "5" } })),
      );
      const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));

      expect(yield* Effect.flip(client.redis.incr("key"))).toMatchObject({
        reason: "rate-limit",
        retryAfterSeconds: 5,
        delivery: "unknown",
      });
      expect(fixture.requests).toHaveLength(1);
    }),
);
