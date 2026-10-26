import { Effect } from "effect";
import type { Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { boolean, nullable, simpleText, tuple, unsigned } from "#/command/reply/Data";
import { blob, integer, mismatch, undecorate } from "#/command/reply/Scalars";
import { score } from "#/command/reply/Score";
import type { RespValue } from "#/protocol/RespValue";

export const losslessValue: ReplyDecoder<RespValue> = Effect.succeed;

/** New module builds use native RESP3 booleans where older builds return integer flags. */
export const moduleBoolean: ReplyDecoder<boolean> = (reply) => {
  const value = undecorate(reply);
  return value._tag === "Boolean" ? Effect.succeed(value.value) : boolean(reply);
};

/** Empty statistical structures can return NaN; this is a numeric sentinel, not a missing reply. */
export const moduleDouble: ReplyDecoder<number> = (reply) => {
  const value = undecorate(reply);
  if (value._tag === "Integer")
    return integer(reply).pipe(
      Effect.flatMap((n) =>
        n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Effect.succeed(Number(n))
          : Effect.fail(mismatch("score", reply)),
      ),
    );
  return (value._tag === "Double" ? Effect.succeed(value.value) : simpleText(reply)).pipe(
    Effect.flatMap((token) => (/^nan$/i.test(token) ? Effect.succeed(Number.NaN) : score(reply))),
  );
};

export const dumpChunk: ReplyDecoder<{
  readonly cursor: bigint;
  readonly chunk: Option.Option<Uint8Array>;
}> = (reply) =>
  tuple(unsigned, nullable(blob))(reply).pipe(Effect.map(([cursor, chunk]) => ({ cursor, chunk })));

/** Cuckoo insertion can report a full filter for one element without aborting its siblings. */
const cuckooInsertElement: ReplyDecoder<-1 | 0 | 1> = (reply) => {
  const value = undecorate(reply);
  if (value._tag === "Boolean") return Effect.succeed(value.value ? 1 : 0);
  return integer(reply).pipe(
    Effect.flatMap((n) =>
      n === -1n || n === 0n || n === 1n
        ? Effect.succeed(Number(n) as -1 | 0 | 1)
        : Effect.fail(mismatch("integer", reply)),
    ),
  );
};
export const cuckooInsertReply = array(cuckooInsertElement);
