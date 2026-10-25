import { Effect, Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { ReplyError } from "#/errors/ReplyError";
import type { RespValue } from "#/protocol/RespValue";

export const undecorate = (reply: RespValue): RespValue => {
  let value = reply;

  while (value._tag === "Attribute") value = value.value;

  return value;
};

export const mismatch = (expected: ReplyError["expected"], reply: RespValue) =>
  new ReplyError({ delivery: "replied", expected, actual: undecorate(reply)._tag, path: [] });

export const blob: ReplyDecoder<Uint8Array> = (reply) => {
  const value = undecorate(reply);

  return value._tag === "BlobString"
    ? Effect.succeed(value.value)
    : Effect.fail(mismatch("blob", reply));
};

export const text: ReplyDecoder<string> = (reply) =>
  blob(reply).pipe(
    Effect.flatMap((value) =>
      Effect.try({
        try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value),
        catch: () => mismatch("text", reply),
      }),
    ),
  );

export const integer: ReplyDecoder<bigint> = (reply) => {
  const value = undecorate(reply);

  return value._tag === "Integer"
    ? Effect.succeed(value.value)
    : Effect.fail(mismatch("integer", reply));
};

export const safeInteger: ReplyDecoder<number> = (reply) =>
  integer(reply).pipe(
    Effect.flatMap((value) =>
      value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)
        ? Effect.fail(mismatch("safe-integer", reply))
        : Effect.succeed(Number(value)),
    ),
  );

export const status =
  (expected: "OK" | "PONG"): ReplyDecoder<void> =>
  (reply) => {
    const value = undecorate(reply);

    return value._tag === "SimpleString" &&
      value.value.length === expected.length &&
      value.value.every((byte, index) => byte === expected.charCodeAt(index))
      ? Effect.void
      : Effect.fail(mismatch("status", reply));
  };

export const optional =
  <A, E, R>(decode: ReplyDecoder<A, E, R>): ReplyDecoder<Option.Option<A>, E, R> =>
  (reply) => {
    const value = undecorate(reply);

    // A null aggregate is not a missing blob, even though RESP2 represents both as nil.
    return value._tag === "Null" && value.kind !== "array"
      ? Effect.succeed(Option.none())
      : decode(reply).pipe(Effect.map(Option.some));
  };
