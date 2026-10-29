import { Effect, ManagedRuntime, Option, Result } from "effect";

import { BatchExecutor, Commands, Redis } from "@effect-kit/redis";
import { RedisNode } from "@effect-kit/redis/node";

import { keySequence, smallKeys } from "#test/runners/benchmarks/Fixtures";
import { large, small, verifyReply } from "#test/runners/benchmarks/Operation";
import type { Operation } from "#test/runners/benchmarks/Operation";
import type { Input } from "#test/runners/benchmarks/Options";

export const effectRedis = async (input: Input): Promise<Operation> => {
  const runtime = ManagedRuntime.make(
    RedisNode.layer({
      endpoint: { host: "127.0.0.1", port: input.port },
      protocol: "resp2",
      commandTimeoutMillis: 10_000,
      sessions: { maxSessionConnections: input.sessionConnections ?? 4 },
    }),
  );

  try {
    const effect = await runtime.runPromise(
      Effect.gen(function* () {
        const redis = yield* Redis;
        const batches = yield* BatchExecutor;
        const key = `${input.prefix}small`;
        const keys = smallKeys(input);
        const nextKey = keySequence(keys);
        for (const fixtureKey of keys) yield* redis.set(fixtureKey, small);
        yield* redis.set(`${input.prefix}large`, large);
        yield* redis.set(`${input.prefix}counter`, "0");

        const build = () => {
          switch (input.workload) {
            case "get-256b-c1":
            case "get-256b-c32":
              return redis.getBytes(nextKey()).pipe(Effect.map(Option.getOrThrow));
            case "get-64k-c8":
              return redis.getBytes(`${input.prefix}large`).pipe(Effect.map(Option.getOrThrow));
            case "set-256b-c16":
              return redis.set(`${input.prefix}write`, small);
            case "incr-c16":
              return redis.incr(`${input.prefix}counter`);
            default: {
              const commands = Array.from(
                { length: input.workload === "pipeline-32-c4" ? 32 : 8 },
                () => Commands.getBytes(key),
              );
              const batch =
                input.workload === "pipeline-32-c4"
                  ? redis
                      .pipeline(commands)
                      .pipe(
                        Effect.map((replies) =>
                          replies.map((reply) => Option.getOrThrow(Result.getOrThrow(reply))),
                        ),
                      )
                  : redis.transaction(commands).pipe(
                      Effect.map((reply) => {
                        if (reply._tag !== "Committed")
                          throw new Error("Unexpected transaction conflict");
                        return reply.results.map((result) =>
                          Option.getOrThrow(Result.getOrThrow(result)),
                        );
                      }),
                    );
              return batch.pipe(Effect.provideService(BatchExecutor, batches));
            }
          }
        };

        return input.construction === "call" ? Effect.suspend(build) : build();
      }),
    );

    return {
      effect,
      promise: () => runtime.runPromise(effect),
      verify: verifyReply(input),
      close: () => runtime.dispose(),
      settings: {
        protocol: "resp2",
        automaticPipelining: false,
        telemetry: false,
        ordinaryConnections: 1,
        maxSessionConnections: input.sessionConnections ?? 4,
      },
    };
  } catch (cause) {
    await runtime.dispose();
    throw cause;
  }
};
