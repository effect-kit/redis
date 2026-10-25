import { Effect } from "effect";

import { decodeReply } from "#/command/Decode";
import type { RedisExecutor } from "#/command/Executor";
import { makeConnection } from "#/connection/Connection";
import { commandToken } from "#/connection/OrdinaryCommand";
import { RoleExpectation } from "#/connection/Role";
import { SentinelError } from "#/errors/SentinelError";
import type { RedisConfig } from "#/RedisConfig";
import { connectionConfig } from "#/sentinel/discovery/Address";
import { discoveryFailure } from "#/sentinel/discovery/Errors";
import type { SentinelOptions, SentinelPolicy } from "#/sentinel/Options";
import type { Transport } from "#/transport/Transport";

export const makeSentinelControl = Effect.fnUntraced(function* <R>(
  endpoints: ReadonlyArray<RedisConfig>,
  policy: SentinelPolicy,
  options: SentinelOptions<R>,
) {
  const captured = yield* Effect.context<R | Transport>();

  return (index: number): RedisExecutor => {
    const executor: RedisExecutor = {
      execute: (command) =>
        command.prepare.pipe(Effect.flatMap((intent) => executor.executePrepared(intent))),
      executePrepared: (intent) =>
        Effect.gen(function* () {
          if (
            commandToken(intent.tokens[0]) !== "SENTINEL" ||
            intent.metadata.family !== "sentinel" ||
            intent.routing._tag !== "Keyless"
          )
            return yield* new SentinelError({
              reason: "routing",
              plane: "sentinel",
              delivery: "unsent",
            });
          const endpoint = endpoints[index];
          if (!Number.isSafeInteger(index) || endpoint?.endpoint._tag !== "Tcp")
            return yield* new SentinelError({
              reason: "routing",
              plane: "sentinel",
              delivery: "unsent",
            });
          const reply = yield* Effect.scoped(
            Effect.gen(function* () {
              const config = yield* connectionConfig(
                endpoint,
                endpoint.endpoint as Extract<RedisConfig["endpoint"], { _tag: "Tcp" }>,
                "sentinel",
                policy,
                options,
              );
              const connection = yield* makeConnection(config, {
                ...options.sentinelConnection,
                reconnectAttempts: 1,
              }).pipe(Effect.mapError((error) => discoveryFailure("sentinel", error)));
              return yield* connection.executeOrdinary(intent.tokens);
            }),
          ).pipe(
            Effect.provideContext(captured),
            Effect.provideService(RoleExpectation, undefined),
          );
          return yield* decodeReply(intent, reply);
        }),
    };
    return executor;
  };
});
