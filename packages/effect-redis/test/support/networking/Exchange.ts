import { Effect } from "effect";

import { makeRespDecoder } from "../../../src/protocol/decode/Decoder.js";
import type { RedisCommand } from "../../../src/protocol/encode.js";
import { encodeCommand } from "../../../src/protocol/encode.js";
import type { TransportConnection } from "../../../src/transport/Transport.js";

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
