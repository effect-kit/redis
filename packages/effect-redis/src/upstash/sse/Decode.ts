import { Effect, Stream } from "effect";
import { Sse } from "effect/encoding";

import { UpstashError } from "#/errors/UpstashError";
import type { UpstashConfig } from "#/upstash/Config";

/** Bound native chunks before the SSE channel buffers decoded events from one feed. */
export const decodeEvents = <E>(source: Stream.Stream<Uint8Array, E>, config: UpstashConfig) =>
  Stream.unwrap(
    Effect.sync(() => {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const utf8 = (bytes?: Uint8Array) =>
        Effect.try({
          try: () =>
            bytes === undefined ? decoder.decode() : decoder.decode(bytes, { stream: true }),
          catch: () =>
            new UpstashError({ stage: "stream", reason: "encoding", delivery: "replied" }),
        });

      const text = source.pipe(
        Stream.flatMap((bytes) =>
          Stream.fromIterable(
            (function* () {
              for (let offset = 0; offset < bytes.length; offset += 4096)
                yield bytes.subarray(offset, offset + 4096);
            })(),
          ),
        ),
        Stream.mapEffect(utf8),
        Stream.concat(Stream.fromEffect(utf8())),
        Stream.rechunk(1),
      );

      return text.pipe(
        Stream.pipeThroughChannel(
          Sse.decode<E | UpstashError, unknown>({ maxEventSize: config.maxEventBytes }),
        ),
        Stream.mapError((error) =>
          error instanceof Sse.SseError || error instanceof Sse.Retry
            ? new UpstashError({
                stage: "stream",
                reason: error instanceof Sse.Retry ? "gap" : "limit",
                delivery: "replied",
              })
            : error,
        ),
        Stream.mapEffect((event) =>
          new TextEncoder().encode(event.data + event.event + (event.id ?? "")).length >
          config.maxEventBytes
            ? Effect.fail(
                new UpstashError({ stage: "stream", reason: "limit", delivery: "replied" }),
              )
            : Effect.succeed(event),
        ),
      );
    }),
  );
