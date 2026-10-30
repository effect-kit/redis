import { Effect, Result } from "effect";

import { ProtocolError } from "#/errors/ProtocolError";
import type { RespDecoder } from "#/protocol/decode/Decoder";
import { makeOwnedRespDecoder, makeRespDecoder } from "#/protocol/decode/Decoder";
import type { RespDecodeLimits } from "#/protocol/limits";
import type { RespValue } from "#/protocol/RespValue";
import { hasOwnedRead } from "#/transport/Ownership";
import type { TransportConnection } from "#/transport/Transport";

export const makeReplyReader = Effect.fnUntraced(function* (
  transport: TransportConnection,
  limits: RespDecodeLimits,
) {
  const makeDecoder = hasOwnedRead(transport.read) ? makeOwnedRespDecoder : makeRespDecoder;
  let decoder: RespDecoder | undefined = yield* Effect.fromResult(makeDecoder(limits));
  let chunk: Uint8Array | undefined;
  let offset = 0;
  let ended = false;

  type Reply = { readonly value: RespValue; readonly wireBytes: number };

  // Poll only owned input. No user codec or transport Effect runs in this loop.
  const poll = (): Result.Result<Reply | undefined, ProtocolError> => {
    const active = decoder;
    if (active === undefined) return Result.succeed(undefined);

    while (true) {
      const before = active.bufferedBytes;
      const parsed = active.next();
      if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
      if (parsed.success !== undefined)
        return Result.succeed({ value: parsed.success, wireBytes: before - active.bufferedBytes });
      if (ended || chunk === undefined || offset === chunk.length) return Result.succeed(undefined);

      // A coalesced transport chunk may exceed capacity: drain before each bounded feed.
      const capacity = limits.maxBufferedBytes - active.bufferedBytes;
      if (capacity <= 0)
        return Result.fail(
          new ProtocolError({
            stage: "decode",
            kind: "LimitExceeded",
            offset: 0,
            limit: "maxBufferedBytes",
            maximum: limits.maxBufferedBytes,
          }),
        );

      const count = Math.min(capacity, chunk.length - offset);
      const fed = active.feed(chunk.subarray(offset, offset + count));
      if (Result.isFailure(fed)) return Result.fail(fed.failure);
      offset += count;
    }
  };

  const next = Effect.gen(function* () {
    while (true) {
      if (decoder === undefined) return undefined;

      const parsed = poll();
      if (Result.isFailure(parsed)) return yield* parsed.failure;
      if (parsed.success !== undefined || ended) return parsed.success;

      chunk = yield* transport.read;
      offset = 0;
      if (decoder === undefined) return undefined;
      if (chunk?.length === 0)
        return yield* new ProtocolError({ stage: "decode", kind: "InvalidArguments", offset: 0 });
      if (chunk === undefined) {
        ended = true;
        decoder.end();
      }
    }
  });

  const drain = Effect.fnUntraced(function* (accept: (reply: Reply) => boolean) {
    const first = yield* next;
    if (first === undefined) return 0;
    if (!accept(first)) return 1;

    let count = 1;
    while (count < 64) {
      const parsed = poll();
      if (Result.isFailure(parsed)) return yield* parsed.failure;
      if (parsed.success === undefined) break;

      count++;
      // Publish each reply before parsing the next: a malformed suffix cannot
      // turn an already received result into an uncertain delivery.
      if (!accept(parsed.success)) break;
    }
    return count;
  });

  return {
    next,
    drain,
    dispose: () => {
      decoder = undefined;
      chunk = undefined;
    },
  };
});

export type ReplyReader = Effect.Success<ReturnType<typeof makeReplyReader>>;
