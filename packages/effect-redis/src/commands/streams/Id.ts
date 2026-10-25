import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { mismatch, text } from "#/command/reply/Scalars";

const Part = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 0n, maximum: 18446744073709551615n }),
);
const Milliseconds = Schema.TemplateLiteral([Part]);

export const StreamId = Schema.TemplateLiteral([Part, "-", Part]);
export type StreamId = typeof StreamId.Type;

export const StreamPosition = Schema.Union([StreamId, Milliseconds]);
export type StreamPosition = typeof StreamPosition.Type;

export const StreamBound = Schema.Union([
  StreamPosition,
  Schema.TemplateLiteral(["(", StreamPosition]),
  Schema.Literals(["-", "+"]),
]);
export type StreamBound = typeof StreamBound.Type;

export const AddId = Schema.Union([
  StreamId,
  Schema.TemplateLiteral([Part, "-*"]),
  Schema.Literal("*"),
]);
export type AddId = typeof AddId.Type;

export const ReadId = Schema.Union([StreamPosition, Schema.Literals(["$", "+"])]);
export type ReadId = typeof ReadId.Type;

export const GroupReadId = Schema.Union([StreamPosition, Schema.Literal(">")]);
export type GroupReadId = typeof GroupReadId.Type;

export const streamId: ReplyDecoder<StreamId> = (reply) =>
  text(reply).pipe(
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(StreamId)(value).pipe(
        Effect.mapError(() => mismatch("custom", reply)),
      ),
    ),
  );

/** IDs contain two uint64 components; no JavaScript Number coercion is involved. */
export const compareIds = (left: StreamId, right: StreamId) => {
  const [leftTime = "0", leftSequence = "0"] = left.split("-");
  const [rightTime = "0", rightSequence = "0"] = right.split("-");
  const delta = BigInt(leftTime) - BigInt(rightTime);
  return delta === 0n ? BigInt(leftSequence) - BigInt(rightSequence) : delta;
};
