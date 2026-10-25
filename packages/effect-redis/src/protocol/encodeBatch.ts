import { Result } from "effect";

import { ProtocolError } from "#/errors/ProtocolError";
import { encodeCommand } from "#/protocol/encode";
import type { RedisCommand } from "#/protocol/encode";
import { encodeLimits } from "#/protocol/limits";
import type { RespEncodeLimits } from "#/protocol/limits";

/** Compound writes retain at most one budget of fragments plus one budget of output bytes. */
export const encodeBatch = (
  commands: ReadonlyArray<RedisCommand>,
  options: Partial<RespEncodeLimits>,
): Result.Result<Uint8Array, ProtocolError> => {
  const parsed = encodeLimits(options);
  if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
  const limits = parsed.success;
  if (
    !Array.isArray(commands) ||
    commands.length === 0 ||
    commands.length > limits.maxAggregateEntries
  )
    return Result.fail(new ProtocolError({ stage: "encode", kind: "InvalidArguments", offset: 0 }));

  const frames: Uint8Array[] = [];
  let total = 0;
  for (const command of commands) {
    if (total >= limits.maxQueuedBytes)
      return Result.fail(
        new ProtocolError({
          stage: "encode",
          kind: "LimitExceeded",
          offset: 0,
          limit: "maxQueuedBytes",
          maximum: limits.maxQueuedBytes,
        }),
      );
    const frame = encodeCommand(command, {
      ...limits,
      maxQueuedBytes: limits.maxQueuedBytes - total,
    });
    if (Result.isFailure(frame)) return Result.fail(frame.failure);
    frames.push(frame.success);
    total += frame.success.length;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const frame of frames) {
    bytes.set(frame, offset);
    offset += frame.length;
  }
  return Result.succeed(bytes);
};
