import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Schema, Stream } from "effect";
import { FetchHttpClient } from "effect/http";

import { Commands, RedisKey, Reply } from "#/index";
import { connect } from "#/node";
import { makeUpstash } from "#/upstash";
import { exchange } from "#test/support/networking/Exchange";
import { recordFixture } from "#test/support/servers/Evidence";
import { httpTargets, upstashFixture } from "#test/support/upstash/Fixture";

it.live.each(httpTargets)(
  "HTTP-CLIENT: $fixture typed families, binary bodies, int64 and Schema",
  (target) =>
    Effect.gen(function* () {
      const fixture = yield* upstashFixture(target);
      const client = yield* makeUpstash(fixture.input).pipe(Effect.provide(FetchHttpClient.layer));
      const oracle = yield* connect(fixture.nativeConfig);
      const prefix = `http:${randomUUID()}`;
      const redis = client.redis;

      yield* redis.set(`${prefix}:binary`, new Uint8Array([0, 255, 128, 13, 10]));
      expect(yield* redis.getBytes(`${prefix}:binary`)).toEqual(
        Option.some(new Uint8Array([0, 255, 128, 13, 10])),
      );
      expect(yield* exchange(oracle, ["GET", `${prefix}:binary`])).toEqual({
        _tag: "BlobString",
        value: new Uint8Array([0, 255, 128, 13, 10]),
      });
      expect(yield* redis.incrby(`${prefix}:number`, 9007199254740993n)).toBe(9007199254740993n);

      const key = RedisKey.json(
        `${prefix}:schema`,
        Schema.Struct({ name: Schema.String, visits: Schema.Int }),
      );
      yield* redis.setKey(key, { name: "BOM\ufeff雪", visits: 3 });
      expect(yield* redis.getKey(key)).toEqual(Option.some({ name: "BOM\ufeff雪", visits: 3 }));
      expect(yield* redis.hset(`${prefix}:hash`, [["field", "value"]])).toBe(1n);
      expect(yield* redis.hget(`${prefix}:hash`, "field")).toEqual(
        Option.some(new TextEncoder().encode("value")),
      );
      yield* redis.rpush(`${prefix}:list`, ["one", "two"]);
      expect(yield* redis.lrange(`${prefix}:list`, 0, -1)).toEqual([
        new TextEncoder().encode("one"),
        new TextEncoder().encode("two"),
      ]);
      yield* redis.sadd(`${prefix}:set`, ["one", "two"]);
      expect(yield* redis.scard(`${prefix}:set`)).toBe(2n);
      yield* redis.zadd(`${prefix}:sorted`, [[1.25, "member"]]);
      expect(yield* redis.zscore(`${prefix}:sorted`, "member")).toEqual(Option.some(1.25));
      const id = yield* redis.xadd(`${prefix}:stream`, "*", [["field", "value"]]);
      expect((yield* redis.xrange(`${prefix}:stream`, "-", "+"))[0]?.id).toBe(id);
      expect(
        yield* redis.execute(
          Commands.evalScript("return 7", { keys: [], args: [] }, Reply.integer),
        ),
      ).toBe(7n);

      const plan = yield* redis.compile([
        Commands.getBytes(`${prefix}:binary`),
        Commands.get(`${prefix}:missing`),
      ]);
      const compiled = yield* plan.execute();
      expect(compiled).toEqual([Option.some(new Uint8Array([0, 255, 128, 13, 10])), Option.none()]);
      expect(
        yield* redis.batch([
          Commands.getBytes(`${prefix}:binary`),
          Commands.get(`${prefix}:missing`),
        ]),
      ).toEqual(compiled);

      yield* recordFixture(`http-client-${target.fixture}`, {
        proxy: fixture.proxy,
        build: fixture.build,
        configurationDigest: fixture.configurationDigest,
        checks: ["binary", "int64", "Schema", "data-families", "streams", "scripting"],
      });
    }),
);

it.live.each(httpTargets)(
  "HTTP-BATCH: $fixture ordered errors and JSON-only transactions retain exact results",
  (target) =>
    Effect.gen(function* () {
      const fixture = yield* upstashFixture(target);
      const client = yield* makeUpstash(fixture.input).pipe(Effect.provide(FetchHttpClient.layer));
      const prefix = `http:${randomUUID()}`;

      const pipeline = yield* client.batches.pipeline([
        Commands.set(`${prefix}:key`, "OK"),
        Commands.incr(`${prefix}:key`),
        Commands.incrby(`${prefix}:number`, 9007199254740993n),
      ]);
      expect(pipeline).toMatchObject([
        { _tag: "Success" },
        { _tag: "Failure", failure: { _tag: "ServerError" } },
        { _tag: "Success", success: 9007199254740993n },
      ]);

      const result = yield* client.batches.transaction([
        Commands.getBytes(`${prefix}:key`),
        Commands.incr(`${prefix}:number`),
        Commands.set(`${prefix}:new`, "yes"),
        Commands.incr(`${prefix}:key`),
      ]);
      expect(result).toMatchObject({
        _tag: "Committed",
        results: [
          { _tag: "Success", success: Option.some(new TextEncoder().encode("OK")) },
          { _tag: "Success", success: 9007199254740994n },
          { _tag: "Success" },
          { _tag: "Failure", failure: { _tag: "ServerError" } },
        ],
      });
      expect(yield* client.redis.get(`${prefix}:new`)).toEqual(Option.some("yes"));
    }),
);

it.live.each(httpTargets)(
  "HTTP-EVENTS: $fixture acknowledged subscriptions and MONITOR release native backend state",
  (target) =>
    Effect.gen(function* () {
      const fixture = yield* upstashFixture(target);
      const client = yield* makeUpstash(fixture.input).pipe(Effect.provide(FetchHttpClient.layer));
      const channel = `http:${randomUUID()}`;
      const subscription = yield* client.events.subscribe(channel);
      const receiving = yield* subscription.messages.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );

      expect(yield* client.redis.publish(channel, "héllo,comma,雪")).toBe(1n);
      expect(yield* Fiber.join(receiving)).toEqual([{ channel, message: "héllo,comma,雪" }]);
      yield* subscription.close;
      expect(yield* client.redis.pubsubNumSub([channel])).toEqual([
        [new TextEncoder().encode(channel), 0n],
      ]);

      const monitor = yield* client.events.monitor();
      const monitored = yield* monitor.messages.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* client.redis.set(`${channel}:key`, "value");
      expect((yield* Fiber.join(monitored))[0]).toMatchObject({ _tag: "Command" });
      yield* monitor.close;
    }),
);
