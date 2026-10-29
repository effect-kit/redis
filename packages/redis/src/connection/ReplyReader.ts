import { Effect } from "effect";

import { ProtocolError } from "#/errors/ProtocolError";
import type { RespDecoder } from "#/protocol/decode/Decoder";
import { makeOwnedRespDecoder, makeRespDecoder } from "#/protocol/decode/Decoder";
import type { RespDecodeLimits } from "#/protocol/limits";
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

  const next = Effect.gen(function* () {
    const active = decoder;
    if (active === undefined) return undefined;

    while (true) {
      const before = active.bufferedBytes;
      const value = yield* Effect.fromResult(active.next());

      if (value !== undefined) return { value, wireBytes: before - active.bufferedBytes };
      if (ended) return undefined;

      if (chunk === undefined || offset === chunk.length) {
        chunk = yield* transport.read;
        offset = 0;

        if (decoder === undefined) return undefined;
        if (chunk?.length === 0)
          return yield* new ProtocolError({ stage: "decode", kind: "InvalidArguments", offset: 0 });

        if (chunk === undefined) {
          ended = true;
          active.end();
          continue;
        }
      }

      // Drain first, then feed only what fits; a transport chunk may exceed decoder capacity.
      const capacity = limits.maxBufferedBytes - active.bufferedBytes;
      if (capacity <= 0)
        return yield* new ProtocolError({
          stage: "decode",
          kind: "LimitExceeded",
          offset: 0,
          limit: "maxBufferedBytes",
          maximum: limits.maxBufferedBytes,
        });

      const count = Math.min(capacity, chunk.length - offset);
      yield* Effect.fromResult(active.feed(chunk.subarray(offset, offset + count)));
      offset += count;
    }
  });

  return {
    next,
    dispose: () => {
      decoder = undefined;
      chunk = undefined;
    },
  };
});

export type ReplyReader = Effect.Success<ReturnType<typeof makeReplyReader>>;
