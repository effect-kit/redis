import { Cause, Context, Effect, Layer, Schema, Stream } from "effect";

import { checkServerReply } from "#/command/Decode";
import { status } from "#/command/reply/Scalars";
import { decode } from "#/config/Validation";
import { PositiveInteger } from "#/config/Validation";
import type { ConnectionOptions } from "#/connection/Options";
import { monitorRecord } from "#/diagnostics/MonitorRecord";
import type { MonitorRecord } from "#/diagnostics/MonitorRecord";
import { DiagnosticError } from "#/errors/DiagnosticError";
import { SubscriptionError } from "#/errors/SubscriptionError";
import { makeMailbox } from "#/events/Mailbox";
import { makeEventOwner } from "#/events/Owner";
import type { EventError } from "#/events/Types";
import type { RedisConfig } from "#/RedisConfig";

export interface MonitorOptions<R = never> {
  readonly maxMessages?: number;
  readonly maxBytes?: number;
  readonly maxLineBytes?: number;
  readonly credentials?: ConnectionOptions<R>["credentials"];
}

const diagnosticFailure = (error: EventError) =>
  error._tag === "SubscriptionError"
    ? new DiagnosticError({
        reason:
          error.reason === "overflow" ||
          error.reason === "concurrent-consumer" ||
          error.reason === "invalid-frame" ||
          error.reason === "capacity"
            ? error.reason
            : "closed",
        generation: error.generation,
      })
    : error;

export const makeRedisMonitor = Effect.fnUntraced(function* <R = never>(
  config: RedisConfig,
  options: MonitorOptions<R> = {},
) {
  const { credentials, ...input } = options;
  const policy = yield* decode(
    Schema.Struct({
      maxMessages: PositiveInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(64))),
      maxBytes: PositiveInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(1024 * 1024))),
      maxLineBytes: PositiveInteger.pipe(
        Schema.withDecodingDefaultKey(
          Effect.succeed(Math.min(64 * 1024, config.limits.maxBufferedBytes)),
        ),
      ),
    }).check(
      Schema.makeFilter((selected) =>
        selected.maxLineBytes <= config.limits.maxBufferedBytes
          ? undefined
          : "Monitor lines must fit within the decoder buffer limit",
      ),
    ),
    "monitor",
    input,
  );
  let active = false;
  let closed = false;
  const mailbox = yield* makeMailbox<MonitorRecord>(
    policy.maxMessages,
    policy.maxBytes,
    { bytes: 0, maximum: policy.maxBytes },
    () => owner.generation(),
  );
  const owner = yield* makeEventOwner(
    // MONITOR carries payload text in simple-string lines, unlike ordinary short RESP headers.
    { ...config, limits: { ...config.limits, maxHeaderBytes: policy.maxLineBytes } },
    credentials === undefined ? {} : { credentials },
    (reply, cost) =>
      Effect.sync(() => {
        if (!active) return false;

        // Parsed text plus retained raw bytes is conservatively charged at three times wire size.
        if (!mailbox.offer(() => monitorRecord(reply), cost * 3))
          owner
            .current()
            ?.retire(
              Cause.fail(
                new SubscriptionError({ reason: "overflow", generation: owner.generation() }),
              ),
            );
        return true;
      }),
    (cause) => mailbox.fail(cause),
    1,
  );
  const wire = yield* owner.open.pipe(Effect.mapError(diagnosticFailure));
  yield* wire
    .request(["MONITOR"], (reply) =>
      checkServerReply(reply).pipe(
        Effect.flatMap(status("OK")),
        Effect.andThen(
          Effect.sync(() => {
            active = true;
            return true;
          }),
        ),
      ),
    )
    .pipe(
      Effect.mapError(diagnosticFailure),
      Effect.onError(() => owner.release),
    );

  const close = Effect.suspend(() => {
    if (closed) return Effect.void;
    closed = true;
    active = false;
    mailbox.fail(Cause.fail(Cause.Done()));

    return owner.release;
  });

  return { events: mailbox.stream.pipe(Stream.mapError(diagnosticFailure)), close };
});

export type RedisMonitorClient = Effect.Success<ReturnType<typeof makeRedisMonitor>>;

export class RedisMonitor extends Context.Service<RedisMonitor, RedisMonitorClient>()(
  "@envoy1084/effect-redis/RedisMonitor",
) {
  static layer<R = never>(config: RedisConfig, options?: MonitorOptions<R>) {
    return Layer.effect(RedisMonitor, makeRedisMonitor(config, options));
  }
}
