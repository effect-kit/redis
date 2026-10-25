import { Effect } from "effect";

import { makeRespDecoder } from "#/protocol/decode/Decoder";
import type { RedisCommand } from "#/protocol/encode";
import { encodeCommand } from "#/protocol/encode";
import type { TransportConnection } from "#/transport/Transport";

/** Single-owner smoke exchange, not a client scheduler. */
export const exchange = Effect.fnUntraced(function* (
  connection: TransportConnection,
  command: RedisCommand,
) {
  const decoder = yield* Effect.fromResult(makeRespDecoder());
  yield* connection.write(yield* Effect.fromResult(encodeCommand(command)));
  while (true) {
    const reply = yield* Effect.fromResult(decoder.next());
    if (reply !== undefined) return reply;
    const bytes = yield* connection.read;
    if (bytes === undefined) {
      decoder.end();
      yield* Effect.fromResult(decoder.next());
      return yield* Effect.fail(new Error("Peer closed without a reply"));
    }
    yield* Effect.fromResult(decoder.feed(bytes));
  }
});
