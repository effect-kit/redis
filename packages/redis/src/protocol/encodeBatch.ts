import { Result } from "effect";

import { ProtocolError } from "#/errors/ProtocolError";
import { measureCommand, writeCommand } from "#/protocol/encode";
import type { RedisCommand } from "#/protocol/encode";
import { encodeLimits } from "#/protocol/limits";
import type { RespEncodeLimits } from "#/protocol/limits";

/** Measure every frame before allocating the single owned compound request. */
export const encodeBatch = (
  commands: ReadonlyArray<RedisCommand>,
  options: Partial<RespEncodeLimits>,
): Result.Result<Uint8Array, ProtocolError> => {
  const parsed = encodeLimits(options);
  if (Result.isFailure(parsed)) return Result.fail(parsed.failure);

  return encodeBatchWithLimits(commands, parsed.success);
};

export const encodeBatchWithLimits = (
  commands: ReadonlyArray<RedisCommand>,
  limits: RespEncodeLimits,
  capacity = limits.maxQueuedBytes,
): Result.Result<Uint8Array, ProtocolError> => {
  if (
    !Array.isArray(commands) ||
    commands.length === 0 ||
    commands.length > limits.maxAggregateEntries
  )
    return Result.fail(new ProtocolError({ stage: "encode", kind: "InvalidArguments", offset: 0 }));

  const frames: Array<{ readonly command: RedisCommand; readonly lengths: ReadonlyArray<number> }> =
    [];
  let total = 0;
  for (const command of commands) {
    if (total >= capacity)
      return Result.fail(
        new ProtocolError({
          stage: "encode",
          kind: "LimitExceeded",
          offset: 0,
          limit: "maxQueuedBytes",
          maximum: capacity,
        }),
      );
    const frame = measureCommand(command, limits, capacity - total);
    if (Result.isFailure(frame)) return Result.fail(frame.failure);
    frames.push({ command, lengths: frame.success.lengths });
    total += frame.success.total;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const frame of frames) {
    const written = writeCommand(frame.command, frame.lengths, bytes, offset);
    if (Result.isFailure(written)) return Result.fail(written.failure);
    offset = written.success;
  }
  return Result.succeed(bytes);
};
