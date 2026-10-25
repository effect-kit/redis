import type { RedisExecutor } from "#/command/Executor";
import type { Integer } from "#/commands/internal/Input";
import * as Read from "#/commands/streams/Read";
import type { RedisArgument } from "#/RedisArgument";

export const streamReadFamily = (executor: RedisExecutor) => ({
  xread: (streams: Read.ReadStreams, options: Omit<Read.StreamReadOptions, "block"> = {}) =>
    executor.execute(Read.xread(streams, options)),
  xreadgroup: (
    group: RedisArgument,
    consumer: RedisArgument,
    streams: Read.GroupReadStreams,
    options: Omit<Read.GroupReadOptions, "block"> = {},
  ) => executor.execute(Read.xreadgroup(group, consumer, streams, options)),
  xreadgroupClaim: (
    group: RedisArgument,
    consumer: RedisArgument,
    streams: Read.GroupReadStreams,
    minIdleMillis: Integer,
    options: Omit<Read.GroupReadOptions, "block"> = {},
  ) => executor.execute(Read.xreadgroupClaim(group, consumer, streams, minIdleMillis, options)),
});

export const blockingStreamFamily = (executor: RedisExecutor) => ({
  xreadBlocking: (streams: Read.ReadStreams, options: Read.BlockingReadOptions) =>
    executor.execute(Read.xread(streams, options)),
  xreadgroupBlocking: (
    group: RedisArgument,
    consumer: RedisArgument,
    streams: Read.GroupReadStreams,
    options: Read.BlockingGroupOptions,
  ) => executor.execute(Read.xreadgroup(group, consumer, streams, options)),
  xreadgroupClaimBlocking: (
    group: RedisArgument,
    consumer: RedisArgument,
    streams: Read.GroupReadStreams,
    minIdleMillis: Integer,
    options: Read.BlockingGroupOptions,
  ) => executor.execute(Read.xreadgroupClaim(group, consumer, streams, minIdleMillis, options)),
});
