import { expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Scope, Stream } from "effect";

import { Commands, Reply } from "#/index";
import { makeUpstash } from "#/upstash";
import { controlledHttp, httpConfig, resp } from "#test/support/upstash/Controlled";
import { controlledEvents } from "#test/support/upstash/Events";

it.effect(
  "closing an HTTP service scope interrupts active requests and rejects retained clients",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<AbortSignal>();
      const fixture = controlledHttp((_request, signal) =>
        Deferred.succeed(started, signal).pipe(Effect.andThen(Effect.never)),
      );
      const scope = yield* Effect.acquireRelease(Scope.make(), (owned) =>
        Scope.close(owned, Exit.succeed(undefined)),
      );
      const client = yield* makeUpstash(httpConfig).pipe(
        Scope.provide(scope),
        Effect.provide(fixture.layer),
      );
      const running = yield* client.redis.incr("key").pipe(Effect.forkChild);
      const signal = yield* Deferred.await(started);

      yield* Scope.close(scope, Exit.succeed(undefined));
      const exit = yield* Fiber.await(running);
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(signal.aborted).toBe(true);
      expect(yield* Effect.flip(client.redis.incr("later"))).toMatchObject({
        reason: "closed",
        delivery: "unsent",
      });
    }),
);

it.effect(
  "JSON-only transactions reject arbitrary raw and script reply types before dispatch",
  () =>
    Effect.gen(function* () {
      const fixture = controlledHttp(() => resp("+OK\r\n"));
      const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));

      expect(
        yield* Effect.flip(
          client.batches.transaction([
            Commands.raw(["GET", "key"], { execution: "ordinary", routing: { _tag: "Keyless" } }),
          ]),
        ),
      ).toMatchObject({ reason: "encoding", delivery: "unsent" });
      expect(
        yield* Effect.flip(
          client.batches.transaction([
            Commands.evalScript("return 1", { keys: [] }, Reply.integer),
          ]),
        ),
      ).toMatchObject({ reason: "encoding", delivery: "unsent" });
      expect(fixture.requests).toHaveLength(0);
    }),
);

it.effect("a completed HTTP reply with a payload decoding error never resends the command", () =>
  Effect.gen(function* () {
    const fixture = controlledHttp(() => resp(new Uint8Array([36, 49, 13, 10, 255, 13, 10])));
    const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));

    expect(yield* Effect.flip(client.redis.get("key"))).toMatchObject({
      _tag: "ReplyError",
      delivery: "replied",
    });
    expect(fixture.requests).toHaveLength(1);
  }),
);

it.effect(
  "SSE slow consumers backpressure a bounded handoff and receive every queued message",
  () =>
    Effect.gen(function* () {
      const fixture = controlledEvents(
        "data: subscribe,updates,1\n\ndata: message,updates,one\n\ndata: message,updates,two\n\ndata: message,updates,three\n\n",
      );
      const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));
      const subscription = yield* client.events.subscribe("updates");
      yield* Effect.yieldNow;

      const messages = yield* subscription.messages.pipe(Stream.take(3), Stream.runCollect);
      expect(messages.map((message) => message.message)).toEqual(["one", "two", "three"]);
      yield* subscription.close;
      expect(fixture.aborted()).toBe(true);
    }),
);

it.effect("SSE enforces a single consumer and cancellation releases a backpressured producer", () =>
  Effect.gen(function* () {
    const fixture = controlledEvents("data: subscribe,updates,1\n\n");
    const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));
    const subscription = yield* client.events.subscribe("updates");
    const first = yield* subscription.messages.pipe(Stream.runCollect, Effect.forkChild);
    yield* Effect.yieldNow;

    expect(yield* Effect.flip(subscription.messages.pipe(Stream.runCollect))).toMatchObject({
      reason: "unsupported",
    });
    yield* subscription.close;
    yield* Fiber.await(first);
    expect(fixture.canceled()).toBe(true);
  }),
);

it.effect(
  "JSON response hints are bound to prepared SET options across asynchronous HTTP work",
  () =>
    Effect.gen(function* () {
      const received = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const fixture = controlledHttp(() =>
        Deferred.succeed(received, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as(
            new Response('[{"result":"OK"}]', {
              headers: { "content-type": "Application/JSON; charset=utf-8" },
            }),
          ),
        ),
      );
      const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));
      const options = { get: false };
      const executing = yield* client.batches
        .transaction([Commands.set("key", "value", options)])
        .pipe(Effect.forkChild);
      yield* Deferred.await(received);

      options.get = true;
      yield* Deferred.succeed(release, undefined);
      const outcome = yield* Fiber.join(executing);
      expect(outcome).toMatchObject({
        _tag: "Committed",
        results: [{ _tag: "Success", success: undefined }],
      });
      expect(fixture.requests).toHaveLength(1);
    }),
);
