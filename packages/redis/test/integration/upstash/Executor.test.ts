import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";

import { Commands, Redis } from "#/index";
import { layer, makeUpstash } from "#/upstash/Upstash";
import {
  controlledHttp,
  httpConfig,
  json,
  requestText,
  resp,
} from "#test/support/upstash/Controlled";

it.effect("HTTP Redis Layer preserves typed facade results and lazy requests", () =>
  Effect.gen(function* () {
    const fixture = controlledHttp(() => resp("$5\r\nhello\r\n"));
    const program = Redis.pipe(Effect.flatMap((redis) => redis.get("key")));
    expect(fixture.requests).toHaveLength(0);

    const value = yield* program.pipe(
      Effect.provide(layer(httpConfig)),
      Effect.provide(fixture.layer),
    );
    expect(Option.getOrThrow(value)).toBe("hello");
    expect(requestText(Option.getOrThrow(Option.fromUndefinedOr(fixture.requests[0])))).toBe(
      '["GET","key"]',
    );
    expect(fixture.requests[0]?.headers.authorization).toBe("Bearer fixture-bearer");
  }),
);

it.effect(
  "HTTP pipeline retains per-slot Redis errors; transaction keeps exact int64 and OK bytes",
  () =>
    Effect.gen(function* () {
      const fixture = controlledHttp((request) =>
        request.url.endsWith("/pipeline")
          ? resp("*3\r\n+OK\r\n-WRONGTYPE private-payload\r\n:9007199254740993\r\n")
          : json('[{"result":"OK"},{"result":"OK"},{"result":9007199254740993}]'),
      );
      const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));

      const pipeline = yield* client.batches.pipeline([
        Commands.set("key", "value"),
        Commands.getBytes("key"),
        Commands.incr("counter"),
      ]);
      expect(pipeline[0]._tag).toBe("Success");
      expect(pipeline[1]).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ServerError", code: "WRONGTYPE" },
      });
      expect(pipeline[2]).toMatchObject({ _tag: "Success", success: 9007199254740993n });

      const transaction = yield* client.batches.transaction([
        Commands.set("key", "OK"),
        Commands.getBytes("key"),
        Commands.incr("counter"),
      ]);
      expect(transaction).toMatchObject({
        _tag: "Committed",
        results: [
          { _tag: "Success" },
          { _tag: "Success", success: Option.some(new TextEncoder().encode("OK")) },
          { _tag: "Success", success: 9007199254740993n },
        ],
      });
    }),
);

it.effect(
  "HTTP rejections distinguish Redis, authentication, status and whole-transaction failures",
  () =>
    Effect.gen(function* () {
      for (const [response, expected] of [
        [() => resp("-WRONGTYPE private\r\n", 400), { _tag: "ServerError", code: "WRONGTYPE" }],
        [
          () => json('{"error":"WRONGPASS private"}', 401),
          { _tag: "UpstashError", reason: "authentication", status: 401 },
        ],
        [() => json('{"error":"limited"}', 429), { _tag: "UpstashError", reason: "rate-limit" }],
        [() => resp("", 302), { _tag: "UpstashError", reason: "status" }],
      ] as const) {
        const fixture = controlledHttp(response);
        const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));
        const error = yield* Effect.flip(client.redis.get("key"));
        expect(error).toMatchObject(expected);
        expect(JSON.stringify(error)).not.toContain("private");
        expect(fixture.requests).toHaveLength(1);
      }

      const client = yield* makeUpstash(httpConfig).pipe(
        Effect.provide(controlledHttp(() => json('{"error":"ERR rejected"}', 400)).layer),
      );
      expect(yield* Effect.flip(client.batches.transaction([Commands.incr("key")]))).toMatchObject({
        _tag: "TransactionError",
        execution: "not-executed",
      });
    }),
);

it.effect("HTTP known session modes and invalid binary batches fail before any request", () =>
  Effect.gen(function* () {
    const fixture = controlledHttp(() => resp("+OK\r\n"));
    const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));
    const command = Commands.set(new Uint8Array([255]), "value");

    expect(yield* Effect.flip(client.batches.pipeline([command]))).toMatchObject({
      delivery: "unsent",
      reason: "encoding",
    });
    expect(
      yield* Effect.flip(
        client.redis.raw(["WATCH", "key"], { routing: { _tag: "Keyless" }, execution: "ordinary" }),
      ),
    ).toMatchObject({ reason: "unsupported" });
    expect(fixture.requests).toHaveLength(0);
  }),
);

it.effect(
  "HTTP capacity, whole-request deadlines and caller cancellation release scoped fetch ownership",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<AbortSignal>();
      const fixture = controlledHttp((_request, signal) =>
        Deferred.succeed(started, signal).pipe(Effect.andThen(Effect.never)),
      );
      const client = yield* makeUpstash({
        ...httpConfig,
        maxConcurrentRequests: 1,
        requestTimeoutMillis: 10,
      }).pipe(Effect.provide(fixture.layer));
      const waiting = yield* client.redis.incr("key").pipe(Effect.forkChild);
      const signal = yield* Deferred.await(started);

      expect(yield* Effect.flip(client.redis.incr("other"))).toMatchObject({
        reason: "capacity",
        delivery: "unsent",
      });
      yield* TestClock.adjust(10);
      expect(yield* Effect.flip(Fiber.join(waiting))).toMatchObject({
        reason: "timeout",
        delivery: "unknown",
      });
      expect(signal.aborted).toBe(true);
      expect(fixture.requests).toHaveLength(1);
    }),
);

it.effect("HTTP lost batch responses retain indexed unknown evidence and never replay", () =>
  Effect.gen(function* () {
    const fixture = controlledHttp(() => json('[{"result":1}]'));
    const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));
    const error = yield* Effect.flip(
      client.batches.pipeline([Commands.incr("a"), Commands.incr("b")]),
    );

    expect(error).toMatchObject({ _tag: "BatchError", execution: "unknown" });
    if (error._tag === "BatchError")
      expect(Redacted.value(error.outcomes)).toMatchObject([
        { _tag: "Unknown", index: 0 },
        { _tag: "Unknown", index: 1 },
      ]);
    expect(fixture.requests).toHaveLength(1);
  }),
);

it.effect("a development proxy's concatenated pipeline dialect requires explicit selection", () =>
  Effect.gen(function* () {
    const fixture = controlledHttp(() => resp("*1\r\n$5\r\nvalue\r\n"));
    const legacy = yield* makeUpstash({ ...httpConfig, pipelineResponseFormat: "frames" }).pipe(
      Effect.provide(fixture.layer),
    );
    const hosted = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));

    const result = yield* legacy.batches.pipeline([Commands.lrange("list", 0, -1)]);
    expect(Result.getOrThrow(result[0])).toEqual([new TextEncoder().encode("value")]);
    const incompatible = yield* hosted.batches.pipeline([Commands.lrange("list", 0, -1)]);
    expect(Result.getFailure(incompatible[0])).toMatchObject({
      _tag: "Some",
      value: { _tag: "ReplyError" },
    });
  }),
);

it.effect("HTTP values batches and compiled plans keep provider validation and typed replies", () =>
  Effect.gen(function* () {
    const fixture = controlledHttp(() => resp("*2\r\n$1\r\nx\r\n:2\r\n"));
    const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));
    const plan = yield* client.redis.compile([Commands.get("a"), Commands.incr("b")]);
    expect(yield* plan.execute()).toEqual([Option.some("x"), 2n]);
    expect(yield* client.redis.batch([Commands.get("a"), Commands.incr("b")])).toEqual([
      Option.some("x"),
      2n,
    ]);
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests.every((request) => request.url.endsWith("/pipeline"))).toBe(true);
  }),
);
