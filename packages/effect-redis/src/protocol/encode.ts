import { Predicate, Result } from "effect";

import { ProtocolError } from "../errors/ProtocolError.js";
import type { RedisArgument } from "../RedisArgument.js";
import { encodeLimits } from "./limits.js";
import type { RespEncodeLimits } from "./limits.js";

export type RedisCommand = readonly [RedisArgument, ...RedisArgument[]];
const textEncoder = new TextEncoder();

// Match TextEncoder's replacement of isolated UTF-16 surrogates, without allocating bytes.
const utf8Length = (text: string, maximum: number): number => {
  let length = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) length++;
    else if (code < 0x800) length += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      length += 4;
      index++;
    } else length += 3;
    if (length > maximum) return length;
  }
  return length;
};

const fail = (kind: ProtocolError["kind"], limit?: string, maximum?: number) =>
  Result.fail(
    new ProtocolError({
      stage: "encode",
      kind,
      offset: 0,
      ...(limit === undefined ? {} : { limit }),
      ...(maximum === undefined ? {} : { maximum }),
    }),
  );

/** Owns the returned frame; tokens are never retained or auto-serialized. */
export const encodeCommand = (
  command: RedisCommand,
  options?: Partial<RespEncodeLimits>,
): Result.Result<Uint8Array, ProtocolError> => {
  const decoded = encodeLimits(options);
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  const limits = decoded.success;
  if (!Array.isArray(command) || command.length === 0) return fail("InvalidArguments");
  if (command.length > limits.maxAggregateEntries)
    return fail("LimitExceeded", "maxAggregateEntries", limits.maxAggregateEntries);
  const lengths: Array<number> = [];
  let total = command.length.toString().length + 3;
  for (const argument of command) {
    if (!Predicate.isString(argument) && !Predicate.isUint8Array(argument))
      return fail("InvalidArguments");
    const size = Predicate.isString(argument)
      ? utf8Length(argument, Math.min(limits.maxBlobBytes, limits.maxQueuedBytes))
      : argument.byteLength;
    if (size > limits.maxBlobBytes)
      return fail("LimitExceeded", "maxBlobBytes", limits.maxBlobBytes);
    total += size.toString().length + size + 5;
    if (total > limits.maxQueuedBytes)
      return fail("LimitExceeded", "maxQueuedBytes", limits.maxQueuedBytes);
    lengths.push(size);
  }
  const frame = new Uint8Array(total);
  let offset = textEncoder.encodeInto(`*${command.length}\r\n`, frame).written;
  for (let index = 0; index < command.length; index++) {
    const argument = command[index];
    const length = lengths[index];
    if (argument === undefined || length === undefined) return fail("InvalidArguments");
    offset += textEncoder.encodeInto(`$${length}\r\n`, frame.subarray(offset)).written;
    if (Predicate.isString(argument))
      textEncoder.encodeInto(argument, frame.subarray(offset, offset + length));
    else frame.set(argument, offset);
    offset += length;
    frame[offset++] = 13;
    frame[offset++] = 10;
  }
  return Result.succeed(frame);
};
