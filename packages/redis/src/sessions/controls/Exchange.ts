import { Effect } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { checkServerReply } from "#/command/Decode";
import type { RedisCommand } from "#/protocol/encode";
import type { SessionWire } from "#/sessions/pool/Wire";

export const exchange = <A>(
  wire: SessionWire,
  tokens: RedisCommand,
  decode: ReplyDecoder<A>,
  timeout?: number | "forever",
) => wire.execute(tokens, timeout).pipe(Effect.flatMap(checkServerReply), Effect.flatMap(decode));
