import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Redacted, Stream } from "effect";
import { TestClock } from "effect/testing";

import { makeUpstash } from "#/upstash/Upstash";
import { httpConfig } from "#test/support/upstash/Controlled";
import { controlledEvents } from "#test/support/upstash/Events";

it.effect(
  "HTTP subscriptions acknowledge before readiness, preserve commas and close their actual response reader",
  () =>
    Effect.gen(function* () {
      const fixture = controlledEvents("data: subscribe,updates,1\n\n");
      const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));
      const subscription = yield* client.events.subscribe("updates");

      const receiving = yield* subscription.messages.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* fixture.send("data: message,updates,héllo,one,two\n\n");
      expect(yield* Fiber.join(receiving)).toEqual([
        { channel: "updates", message: "héllo,one,two" },
      ]);

      yield* subscription.close;
      expect(fixture.aborted()).toBe(true);
      expect(fixture.canceled()).toBe(true);
      expect(yield* Effect.flip(subscription.messages.pipe(Stream.runCollect))).toMatchObject({
        reason: "closed",
      });
    }),
);

it.effect("HTTP MONITOR uses acknowledged diagnostic records and keeps payloads redacted", () =>
  Effect.gen(function* () {
    const fixture = controlledEvents('data: "OK"\n\n');
    const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));
    const monitor = yield* client.events.monitor();
    const receiving = yield* monitor.messages.pipe(
      Stream.take(1),
      Stream.runCollect,
      Effect.forkChild,
    );

    yield* fixture.send(
      'data: 1721284005.242090 [0 127.0.0.1:42] "SET" "private-key" "private-value"\n\n',
    );
    const [record] = yield* Fiber.join(receiving);
    expect(record).toMatchObject({ _tag: "Command", timestamp: "1721284005.242090", database: 0n });
    if (record?._tag === "Command")
      expect(Redacted.value(record.commandLine)).toContain("private-value");
    expect(
      JSON.stringify(record, (_, value) => (typeof value === "bigint" ? String(value) : value)),
    ).not.toContain("private-value");
  }),
);

it.effect(
  "SSE EOF exposes a gap; initialization cannot succeed without the correct acknowledgment",
  () =>
    Effect.gen(function* () {
      const fixture = controlledEvents("data: subscribe,updates,1\n\n");
      const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));
      const subscription = yield* client.events.subscribe("updates");
      const receiving = yield* subscription.messages.pipe(Stream.runCollect, Effect.forkChild);

      yield* fixture.end;
      expect(yield* Effect.flip(Fiber.join(receiving))).toMatchObject({ reason: "gap" });
      expect(fixture.requests).toHaveLength(1);

      const invalid = controlledEvents("data: subscribe,other,1\n\n");
      const other = yield* makeUpstash(httpConfig).pipe(Effect.provide(invalid.layer));
      expect(yield* Effect.flip(other.events.subscribe("updates"))).toMatchObject({
        reason: "malformed",
      });
      expect(invalid.aborted()).toBe(true);
    }),
);

it.effect("SSE initialization timeout aborts and joins the stream without reconnecting", () =>
  Effect.gen(function* () {
    const fixture = controlledEvents(": waiting\n\n");
    const client = yield* makeUpstash({ ...httpConfig, streamHandshakeTimeoutMillis: 10 }).pipe(
      Effect.provide(fixture.layer),
    );
    const waiting = yield* client.events.subscribe("updates").pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* TestClock.adjust(10);

    expect(yield* Effect.flip(Fiber.join(waiting))).toMatchObject({ reason: "timeout" });
    expect(fixture.aborted()).toBe(true);
    expect(fixture.requests).toHaveLength(1);
  }),
);

it.effect("SSE rejects ambiguous channels before any HTTP request", () =>
  Effect.gen(function* () {
    const fixture = controlledEvents("");
    const client = yield* makeUpstash(httpConfig).pipe(Effect.provide(fixture.layer));

    for (const channel of ["", "one,two", "line\nfeed", "nul\u0000"])
      expect(yield* Effect.flip(client.events.subscribe(channel))).toMatchObject({
        reason: "encoding",
        delivery: "unsent",
      });
    expect(fixture.requests).toHaveLength(0);
  }),
);
