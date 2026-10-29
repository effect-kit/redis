import { Result } from "effect";

import { ProtocolError } from "#/errors/ProtocolError";
import { cachedGroups, cacheGroups } from "#/protocol/CompiledFrames";
import { measureCommand, writeCommand } from "#/protocol/encode";
import type { RedisCommand } from "#/protocol/encode";
import type { RespEncodeLimits } from "#/protocol/limits";

/** Independent bounded slabs avoid pinning an entire batch behind its last pending reply. */
export const encodeGroups = (
  commands: ReadonlyArray<RedisCommand>,
  limits: RespEncodeLimits,
  capacity: number,
  maximumCommands: number,
  maximumBytes: number,
): Result.Result<ReadonlyArray<ReadonlyArray<Uint8Array>>, ProtocolError> => {
  const cached = cachedGroups(commands, limits);
  if (cached !== undefined) {
    const total = cached.reduce(
      (sum, group) => sum + group.reduce((bytes, frame) => bytes + frame.length, 0),
      0,
    );
    if (total <= capacity) return Result.succeed(cached);
    return Result.fail(
      new ProtocolError({
        stage: "encode",
        kind: "LimitExceeded",
        offset: 0,
        limit: "maxQueuedBytes",
        maximum: capacity,
      }),
    );
  }

  const measured = [];
  let total = 0;

  // Validate and measure the complete batch before allocating any wire storage.
  for (const command of commands) {
    const frame = measureCommand(command, limits, Math.min(capacity - total, maximumBytes));
    if (Result.isFailure(frame)) return Result.fail(frame.failure);
    measured.push({ command, ...frame.success });
    total += frame.success.total;
  }

  const groups: Array<ReadonlyArray<Uint8Array>> = [];
  let start = 0;
  while (start < measured.length) {
    let end = start;
    let bytes = 0;
    while (end < measured.length && end - start < maximumCommands) {
      const frame = measured[end];
      if (frame === undefined) throw new Error("Missing measured group boundary");
      if (end > start && bytes + frame.total > Math.min(64 * 1024, maximumBytes)) break;
      bytes += frame.total;
      end++;
    }

    const slab = new Uint8Array(bytes);
    const frames: Uint8Array[] = [];
    let offset = 0;
    for (let index = start; index < end; index++) {
      const frame = measured[index];
      if (frame === undefined) throw new Error("Missing measured frame");
      const written = writeCommand(frame.command, frame.lengths, slab, offset);
      if (Result.isFailure(written)) return Result.fail(written.failure);
      frames.push(slab.subarray(offset, written.success));
      offset = written.success;
    }
    groups.push(frames);
    start = end;
  }

  cacheGroups(commands, limits, groups);
  return Result.succeed(groups);
};
