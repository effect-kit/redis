import { Cause, Deferred, Effect, Exit, Fiber, Queue, Redacted, Schema, Stream } from "effect";
import type { Scope } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { FetchHttpClient } from "effect/http";

import { monitorRecord } from "#/diagnostics/MonitorRecord";
import type { MonitorRecord } from "#/diagnostics/MonitorRecord";
import { UpstashError } from "#/errors/UpstashError";
import type { UpstashHttpClient } from "#/upstash/http/Client";
import { checkStatus, requestError, responseError } from "#/upstash/http/Exchange";
import { decodeEvents } from "#/upstash/sse/Decode";

export interface UpstashMessage {
  readonly channel: string;
  readonly message: string;
}
export interface UpstashSubscription<A> {
  readonly messages: Stream.Stream<A, UpstashError>;
  readonly close: Effect.Effect<void>;
}

const failure = (reason: UpstashError["reason"], delivery: UpstashError["delivery"] = "replied") =>
  new UpstashError({ stage: "stream", reason, delivery });

const ChannelName = Schema.NonEmptyString.check(
  Schema.isPattern(/^[^,\r\n]+$/),
  Schema.makeFilter(
    (value) =>
      !value.includes("\u0000") &&
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value),
  ),
);

const open = <A>(
  http: UpstashHttpClient,
  path: string,
  acknowledge: string,
  decode: (text: string) => Effect.Effect<A, UpstashError>,
) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const queue = yield* Queue.make<A, UpstashError | Cause.Done>({
      capacity: 1,
      strategy: "dropping",
    });
    const ready = yield* Deferred.make<void, UpstashError>();
    let stopped = false;
    let consuming = false;

    const produce = http
      .run(
        Effect.gen(function* () {
          const response = yield* HttpClient.withScope(http.client)
            .execute(
              HttpClientRequest.post(http.config.url + path).pipe(
                HttpClientRequest.setHeaders({
                  authorization: `Bearer ${Redacted.value(http.config.token)}`,
                  accept: "text/event-stream",
                }),
              ),
            )
            .pipe(
              Effect.provideService(FetchHttpClient.RequestInit, {
                redirect: "manual",
                cache: "no-store",
              }),
              Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
              Effect.mapError(requestError),
            );
          yield* checkStatus(response);
          if (!response.headers["content-type"]?.toLowerCase().startsWith("text/event-stream"))
            return yield* failure("malformed");

          let acknowledged = false;
          const bytes = response.stream.pipe(Stream.mapError(responseError));
          const events = decodeEvents(bytes, http.config);
          const selected =
            http.config.streamIdleTimeoutMillis === undefined
              ? events
              : events.pipe(
                  Stream.timeoutOrElse({
                    duration: http.config.streamIdleTimeoutMillis,
                    orElse: () => Stream.fail(failure("timeout")),
                  }),
                );

          yield* selected.pipe(
            Stream.runForEach((event) =>
              Effect.gen(function* () {
                if (!acknowledged) {
                  if (event.data !== acknowledge) return yield* failure("malformed");
                  acknowledged = true;
                  yield* Deferred.succeed(ready, undefined);
                  return;
                }

                const message = yield* decode(event.data);
                if (!(yield* Queue.offer(queue, message))) return yield* failure("limit");
              }),
            ),
          );
          return yield* failure("gap");
        }),
      )
      .pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            if (Exit.isFailure(exit) && !stopped) {
              yield* Deferred.failCause(ready, exit.cause);
              yield* Queue.failCause(queue, exit.cause);
            } else yield* Queue.end(queue);
          }),
        ),
      );

    const producer = yield* Effect.forkIn(produce, scope);
    const close = Effect.gen(function* () {
      stopped = true;
      yield* Fiber.interrupt(producer);
      yield* Queue.shutdown(queue);

      const exit = yield* Fiber.await(producer);
      if (Exit.isFailure(exit)) {
        const defects = exit.cause.reasons.filter(Cause.isDieReason);
        if (defects.length > 0) return yield* Effect.failCause(Cause.fromReasons<never>(defects));
      }
    });
    yield* Effect.addFinalizer(() => close);

    yield* Deferred.await(ready).pipe(
      Effect.timeoutOrElse({
        duration: http.config.streamHandshakeTimeoutMillis,
        orElse: () => Effect.fail(failure("timeout", "unknown")),
      }),
      Effect.onError(() => close),
    );

    const messages = Stream.unwrap(
      Effect.gen(function* () {
        if (stopped) return yield* failure("closed");
        if (consuming) return yield* failure("unsupported");
        consuming = true;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            consuming = false;
          }),
        );
        return Stream.fromQueue(queue);
      }),
    );

    return { messages, close } satisfies UpstashSubscription<A>;
  });

export const makeSubscriptions = (http: UpstashHttpClient) => ({
  /** SSE's comma-delimited envelope is text-only; one known, unambiguous channel is bound per request. */
  subscribe: (
    channel: string,
  ): Effect.Effect<UpstashSubscription<UpstashMessage>, UpstashError, Scope.Scope> =>
    Schema.decodeUnknownEffect(ChannelName)(channel).pipe(
      Effect.mapError(() => failure("encoding", "unsent")),
      Effect.flatMap((selected) => {
        const path = `/subscribe/${encodeURIComponent(selected)}`;
        if (new TextEncoder().encode(path).length > http.config.maxRequestBytes)
          return Effect.fail(failure("limit", "unsent"));

        const prefix = `message,${selected},`;
        return open(http, path, `subscribe,${selected},1`, (text) =>
          text.startsWith(prefix)
            ? Effect.succeed({ channel: selected, message: text.slice(prefix.length) })
            : Effect.fail(failure("malformed")),
        );
      }),
    ),

  monitor: (): Effect.Effect<UpstashSubscription<MonitorRecord>, UpstashError, Scope.Scope> =>
    open(http, "/monitor", '"OK"', (text) =>
      Effect.succeed(
        monitorRecord({ _tag: "SimpleString", value: new TextEncoder().encode(text) }),
      ),
    ),
});
