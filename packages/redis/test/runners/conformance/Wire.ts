import { Effect } from "effect";

import type { RedisCommand, TransportConnection } from "#/index";
import { core } from "#test/runners/conformance/Runtime";

/** A second physical connection observes server state through lossless built-artifact framing. */
export const exchange = Effect.fnUntraced(function* (
  connection: TransportConnection,
  command: RedisCommand,
) {
  const decoder = yield* Effect.fromResult(core.makeRespDecoder());
  yield* connection.write(yield* Effect.fromResult(core.encodeCommand(command)));

  while (true) {
    const reply = yield* Effect.fromResult(decoder.next());
    if (reply !== undefined) return reply;
    const chunk = yield* connection.read;
    if (chunk === undefined) return yield* Effect.fail(new Error("Oracle closed before replying"));
    yield* Effect.fromResult(decoder.feed(chunk));
  }
});
