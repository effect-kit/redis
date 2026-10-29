import { Predicate, Result } from "effect";

import { ProtocolError } from "#/errors/ProtocolError";
import { encodeLimits } from "#/protocol/limits";
import type { RespEncodeLimits } from "#/protocol/limits";
import type { RedisArgument } from "#/RedisArgument";

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

  return encodeCommandWithLimits(command, decoded.success);
};

/** Internal connections already validated their immutable limits at acquisition. */
export const encodeCommandWithLimits = (
  command: RedisCommand,
  limits: RespEncodeLimits,
  capacity = limits.maxQueuedBytes,
): Result.Result<Uint8Array, ProtocolError> => {
  const measured = measureCommand(command, limits, capacity);
  if (Result.isFailure(measured)) return Result.fail(measured.failure);

  const frame = new Uint8Array(measured.success.total);
  const written = writeCommand(command, measured.success.lengths, frame, 0);
  if (Result.isFailure(written)) return Result.fail(written.failure);
  return Result.succeed(frame);
};

export const measureCommand = (
  command: RedisCommand,
  limits: RespEncodeLimits,
  capacity: number,
): Result.Result<
  { readonly total: number; readonly lengths: ReadonlyArray<number> },
  ProtocolError
> => {
  if (!Array.isArray(command) || command.length === 0) return fail("InvalidArguments");
  if (command.length > limits.maxAggregateEntries)
    return fail("LimitExceeded", "maxAggregateEntries", limits.maxAggregateEntries);

  const lengths: Array<number> = [];
  let total = command.length.toString().length + 3;

  // Measure the complete frame before allocating any payload-sized storage.
  for (const argument of command) {
    if (!Predicate.isString(argument) && !Predicate.isUint8Array(argument))
      return fail("InvalidArguments");

    const size = Predicate.isString(argument)
      ? utf8Length(argument, Math.min(limits.maxBlobBytes, capacity))
      : argument.byteLength;
    if (size > limits.maxBlobBytes)
      return fail("LimitExceeded", "maxBlobBytes", limits.maxBlobBytes);

    total += size.toString().length + size + 5;
    if (total > capacity) return fail("LimitExceeded", "maxQueuedBytes", capacity);

    lengths.push(size);
  }

  return Result.succeed({ total, lengths });
};

/** Fill a measured span directly, including compound requests, without intermediate payload frames. */
export const writeCommand = (
  command: RedisCommand,
  lengths: ReadonlyArray<number>,
  frame: Uint8Array,
  start: number,
): Result.Result<number, ProtocolError> => {
  let offset = writeHeader(42, command.length, frame, start);

  for (let index = 0; index < command.length; index++) {
    const argument = command[index];
    const length = lengths[index];
    if (argument === undefined || length === undefined) return fail("InvalidArguments");

    offset = writeHeader(36, length, frame, offset);
    if (Predicate.isString(argument))
      textEncoder.encodeInto(argument, frame.subarray(offset, offset + length));
    else frame.set(argument, offset);

    offset += length;
    frame[offset++] = 13;
    frame[offset++] = 10;
  }

  return Result.succeed(offset);
};

const writeHeader = (marker: number, length: number, frame: Uint8Array, start: number) => {
  const digits = String(length);
  let offset = start;
  frame[offset++] = marker;
  for (let index = 0; index < digits.length; index++) frame[offset++] = digits.charCodeAt(index);
  frame[offset++] = 13;
  frame[offset++] = 10;
  return offset;
};
