import { expect, it } from "@effect/vitest";
import { Cause, Clock, Context, Deferred, Effect, Fiber, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";

import { Commands, Redis, RedisCredentials, RedisProfiles } from "#/index";
import { RedisUpstash } from "#/upstash";
import { controlledHttp, httpConfig, resp } from "#test/support/upstash/Controlled";

it.effect("HTTP tokens are lazy, coalesced and refreshed for future requests", () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    const started = yield* Deferred.make<void>();
    let calls = 0;
    const credentials = RedisCredentials.provider(
      Effect.gen(function* () {
        const attempt = ++calls;
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release);
        return {
          password: Redacted.make(`synthetic-${attempt}`),
          expiresAtMillis: (yield* Clock.currentTimeMillis) + 1000,
        };
      }),
      { refreshBeforeMillis: 100 },
    );
    const fixture = controlledHttp(() => resp("+PONG\r\n"));
    const context = yield* Layer.build(
      RedisUpstash.layerWithHttpClient({ url: httpConfig.url, credentials }).pipe(
        Layer.provide(fixture.layer),
      ),
    );
    const redis = Context.get(context, Redis);
    expect(calls).toBe(0);

    const first = yield* redis.ping().pipe(Effect.forkChild);
    const second = yield* redis.ping().pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* Effect.yieldNow;
    expect(fixture.requests).toHaveLength(0);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    expect(calls).toBe(1);
    expect(fixture.requests.map((request) => request.headers.authorization)).toEqual([
      "Bearer synthetic-1",
      "Bearer synthetic-1",
    ]);

    yield* TestClock.adjust(900);
    yield* redis.ping();
    expect(calls).toBe(2);
    expect(fixture.requests[2]?.headers.authorization).toBe("Bearer synthetic-2");
  }),
);

it.effect("credential failures are redacted and never dispatch an HTTP request", () =>
  Effect.gen(function* () {
    const fixture = controlledHttp(() => resp("+PONG\r\n"));
    const context = yield* Layer.build(
      RedisUpstash.layerWithHttpClient({
        url: httpConfig.url,
        credentials: Effect.fail({ secret: "synthetic-private" }),
      }).pipe(Layer.provide(fixture.layer)),
    );
    const error = yield* Effect.flip(Context.get(context, Redis).ping());
    expect(error).toMatchObject({
      _tag: "UpstashError",
      reason: "credentials",
      delivery: "unsent",
    });
    expect(JSON.stringify(error)).not.toContain("synthetic-private");
    expect(fixture.requests).toHaveLength(0);
  }),
);

it.effect("the whole HTTP deadline includes credential acquisition without claiming dispatch", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const fixture = controlledHttp(() => resp("+PONG\r\n"));
    const context = yield* Layer.build(
      RedisUpstash.layerWithHttpClient({
        url: httpConfig.url,
        requestTimeoutMillis: 10,
        credentials: Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      }).pipe(Layer.provide(fixture.layer)),
    );
    const pending = yield* Context.get(context, Redis).ping().pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* TestClock.adjust(10);
    expect(yield* Effect.flip(Fiber.join(pending))).toMatchObject({
      _tag: "UpstashError",
      reason: "timeout",
      delivery: "unsent",
    });
    expect(fixture.requests).toHaveLength(0);
  }),
);

it.effect("rotation aborts dispatched batches, preserves uncertainty and uses a new bearer", () =>
  Effect.gen(function* () {
    const dispatched = yield* Deferred.make<AbortSignal>();
    let calls = 0;
    const fixture = controlledHttp((_request, signal) =>
      fixture.requests.length === 1
        ? Deferred.succeed(dispatched, signal).pipe(Effect.andThen(Effect.never))
        : resp("+PONG\r\n"),
    );
    const context = yield* Layer.build(
      RedisUpstash.layerWithHttpClient({
        url: httpConfig.url,
        credentials: RedisCredentials.provider(
          Effect.gen(function* () {
            return {
              password: Redacted.make(`synthetic-${++calls}`),
              expiresAtMillis: (yield* Clock.currentTimeMillis) + 1000,
            };
          }),
          { refreshBeforeMillis: 0 },
        ),
      }).pipe(Layer.provide(fixture.layer)),
    );
    const redis = Context.get(context, Redis);
    const pending = yield* redis
      .pipeline([Commands.incr("counter")])
      .pipe(Effect.provideContext(context), Effect.forkChild);
    const signal = yield* Deferred.await(dispatched);
    yield* Context.get(context, RedisCredentials).rotate;
    const exit = yield* Fiber.await(pending);
    if (exit._tag !== "Failure") return yield* Effect.die("Expected interrupted batch");
    expect(Cause.hasInterrupts(exit.cause)).toBe(true);
    const failure = Cause.findError(exit.cause);
    if (failure._tag !== "Success" || failure.success._tag !== "BatchError")
      return yield* Effect.die("Missing batch evidence");
    expect(failure.success.execution).toBe("unknown");
    expect(Redacted.value(failure.success.outcomes)).toMatchObject([{ _tag: "Unknown", index: 0 }]);
    expect(signal.aborted).toBe(true);

    yield* redis.ping();
    expect(fixture.requests[1]?.headers.authorization).toBe("Bearer synthetic-2");
    expect(fixture.requests).toHaveLength(2);
  }),
);

it.effect("interruption before acquiring a bearer keeps batch slots unsent", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const fixture = controlledHttp(() => resp(":1\r\n"));
    const context = yield* Layer.build(
      RedisUpstash.layerWithHttpClient({
        url: httpConfig.url,
        credentials: Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      }).pipe(Layer.provide(fixture.layer)),
    );
    const pending = yield* Context.get(context, Redis)
      .pipeline([Commands.incr("counter")])
      .pipe(Effect.provideContext(context), Effect.forkChild);
    yield* Deferred.await(started);
    yield* Fiber.interrupt(pending);
    const exit = yield* Fiber.await(pending);
    if (exit._tag !== "Failure") return yield* Effect.die("Expected interrupted batch");
    expect(Cause.hasInterrupts(exit.cause)).toBe(true);
    const failure = Cause.findError(exit.cause);
    if (failure._tag !== "Success" || failure.success._tag !== "BatchError")
      return yield* Effect.die("Missing batch evidence");
    expect(failure.success.execution).toBe("not-executed");
    expect(Redacted.value(failure.success.outcomes)).toMatchObject([{ _tag: "Unsent", index: 0 }]);
    expect(fixture.requests).toHaveLength(0);
  }),
);

it.effect("HTTP profile gates apply before requests and validate the configured origin", () =>
  Effect.gen(function* () {
    const fixture = controlledHttp(() => resp("+OK\r\n"));
    const profile = { ...RedisProfiles.upstash({ transport: "http" }), enabledModules: [] };
    const context = yield* Layer.build(
      RedisUpstash.layerWithHttpClient({ ...httpConfig, profile }).pipe(
        Layer.provide(fixture.layer),
      ),
    );
    expect(yield* Effect.flip(Context.get(context, Redis).jsonGet("private"))).toMatchObject({
      _tag: "ProfileError",
      reason: "module",
    });
    expect(fixture.requests).toHaveLength(0);

    const invalid = RedisUpstash.layerWithHttpClient({
      ...httpConfig,
      url: "http://127.0.0.1:6379",
      allowInsecureLocalhost: true,
      profile,
    }).pipe(Layer.provide(fixture.layer));
    expect(yield* Effect.flip(Layer.build(invalid))).toMatchObject({
      _tag: "ProfileError",
      reason: "tls",
    });
  }),
);
