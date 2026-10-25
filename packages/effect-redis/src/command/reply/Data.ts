import { Effect, Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { blob, integer, mismatch, text, undecorate } from "#/command/reply/Scalars";
import { ReplyError } from "#/errors/ReplyError";
import type { RespValue } from "#/protocol/RespValue";

const atIndex =
  <A>(decode: ReplyDecoder<A>, index: number): ReplyDecoder<A> =>
  (reply) =>
    decode(reply).pipe(
      Effect.mapError((error) => new ReplyError({ ...error, path: [index, ...error.path] })),
    );

export const boolean: ReplyDecoder<boolean> = (reply) =>
  integer(reply).pipe(
    Effect.flatMap((value) =>
      value === 0n || value === 1n
        ? Effect.succeed(value === 1n)
        : Effect.fail(mismatch("custom", reply)),
    ),
  );

/** Aggregate nulls represent empty pops/positions, while scalar optional decoders reject them. */
export const nullable =
  <A>(decode: ReplyDecoder<A>): ReplyDecoder<Option.Option<A>> =>
  (reply) =>
    undecorate(reply)._tag === "Null"
      ? Effect.succeed(Option.none())
      : decode(reply).pipe(Effect.map(Option.some));

export const members =
  <A>(decode: ReplyDecoder<A>): ReplyDecoder<ReadonlyArray<A>> =>
  (reply) => {
    const value = undecorate(reply);

    return value._tag === "Set"
      ? Effect.forEach(value.values, (entry, index) => atIndex(decode, index)(entry))
      : array(decode)(reply);
  };

/** Keep field order and binary keys; RESP3 maps must never be coerced to JS object keys. */
export const pairs =
  <A, B>(
    left: ReplyDecoder<A>,
    right: ReplyDecoder<B>,
  ): ReplyDecoder<ReadonlyArray<readonly [A, B]>> =>
  (reply) => {
    const value = undecorate(reply);
    let entries: ReadonlyArray<readonly [RespValue, RespValue]>;

    if (value._tag === "Map") entries = value.entries;
    else if (
      value._tag === "Array" &&
      value.values.length > 0 &&
      value.values.every((entry) => entry._tag === "Array")
    ) {
      const nested: Array<readonly [RespValue, RespValue]> = [];

      for (const entry of value.values) {
        if (entry._tag !== "Array" || entry.values.length !== 2)
          return Effect.fail(mismatch("array", reply));
        const [a, b] = entry.values;
        if (a === undefined || b === undefined) return Effect.fail(mismatch("array", reply));
        nested.push([a, b]);
      }

      entries = nested;
    } else if (value._tag === "Array" && value.values.length % 2 === 0) {
      const collected: Array<readonly [RespValue, RespValue]> = [];

      for (let index = 0; index < value.values.length; index += 2) {
        const a = value.values[index];
        const b = value.values[index + 1];
        if (a === undefined || b === undefined) return Effect.fail(mismatch("array", reply));
        collected.push([a, b]);
      }

      entries = collected;
    } else return Effect.fail(mismatch("array", reply));

    return Effect.forEach(entries, ([a, b], index) =>
      Effect.all([atIndex(left, 0)(a), atIndex(right, 1)(b)]).pipe(
        Effect.map(([key, result]) => [key, result] as const),
        Effect.mapError((error) => new ReplyError({ ...error, path: [index, ...error.path] })),
      ),
    );
  };

export const tuple =
  <A, B>(left: ReplyDecoder<A>, right: ReplyDecoder<B>): ReplyDecoder<readonly [A, B]> =>
  (reply) => {
    const value = undecorate(reply);
    if (value._tag !== "Array" || value.values.length !== 2)
      return Effect.fail(mismatch("array", reply));
    const [a, b] = value.values;
    if (a === undefined || b === undefined) return Effect.fail(mismatch("array", reply));

    return Effect.all([atIndex(left, 0)(a), atIndex(right, 1)(b)]);
  };

export const blobs = array(blob);

export const simpleText: ReplyDecoder<string> = (reply) => {
  const value = undecorate(reply);
  return value._tag === "SimpleString"
    ? text({ _tag: "BlobString", value: value.value })
    : text(reply);
};

/** Redis uses big-number/decimal bulk replies for unsigned values above signed int64. */
export const unsigned: ReplyDecoder<bigint> = (reply) => {
  const value = undecorate(reply);
  const decoded =
    value._tag === "Integer" || value._tag === "BigNumber"
      ? Effect.succeed(value.value)
      : text(reply).pipe(
          Effect.flatMap((token) =>
            /^[0-9]{1,20}$/.test(token)
              ? Effect.succeed(BigInt(token))
              : Effect.fail(mismatch("integer", reply)),
          ),
        );

  return decoded.pipe(
    Effect.flatMap((number) =>
      number >= 0n && number <= 18446744073709551615n
        ? Effect.succeed(number)
        : Effect.fail(mismatch("integer", reply)),
    ),
  );
};

/** Long-double commands may return finite decimals outside JavaScript's number range. */
export const decimalToken: ReplyDecoder<string> = (reply) => {
  const value = undecorate(reply);
  const decoded = value._tag === "Double" ? Effect.succeed(value.value) : text(reply);

  return decoded.pipe(
    Effect.flatMap((token) =>
      /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(token)
        ? Effect.succeed(token)
        : Effect.fail(mismatch("score", reply)),
    ),
  );
};

export const withLength =
  <A>(length: number, decode: ReplyDecoder<ReadonlyArray<A>>): ReplyDecoder<ReadonlyArray<A>> =>
  (reply) =>
    decode(reply).pipe(
      Effect.flatMap((values) =>
        values.length === length
          ? Effect.succeed(values)
          : Effect.fail(mismatch("array-length", reply)),
      ),
    );
