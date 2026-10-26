import { Context, Effect, Exit, Scope } from "effect";

import { decodeReply } from "#/command/Decode";
import type { RedisExecutor } from "#/command/Executor";
import { makeConnection } from "#/connection/Connection";
import { commandToken } from "#/connection/OrdinaryCommand";
import { RoleExpectation } from "#/connection/Role";
import { SentinelError } from "#/errors/SentinelError";
import type { RedisCommand } from "#/protocol/encode";
import type { RedisConfig } from "#/RedisConfig";
import { connectionConfig } from "#/sentinel/discovery/Address";
import { discoveryFailure } from "#/sentinel/discovery/Errors";
import { makeSentinelAdmission } from "#/sentinel/execution/Admission";
import type { SentinelManager } from "#/sentinel/generation/Manager";
import type { SentinelOptions, SentinelPolicy } from "#/sentinel/Options";
import type { Transport } from "#/transport/Transport";

export const makeSentinelControl = Effect.fnUntraced(function* <RData, RSentinel>(
  endpoints: ReadonlyArray<RedisConfig>,
  policy: SentinelPolicy,
  options: SentinelOptions<RData, RSentinel>,
  manager: Pick<SentinelManager, "check" | "scope" | "poison">,
) {
  const captured = yield* Effect.context<RData | RSentinel | Transport>();
  const admission = makeSentinelAdmission(policy.maxOperations, policy.operationTimeoutMillis);

  const request = (endpoint: RedisConfig, tokens: RedisCommand) =>
    admission.run((writing) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* manager.check();
          const address = endpoint.endpoint;
          if (address._tag !== "Tcp")
            return yield* new SentinelError({
              reason: "routing",
              plane: "sentinel",
              delivery: "unsent",
            });

          const scope = yield* Scope.fork(manager.scope);
          const close = Scope.close(scope, Exit.void).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (Exit.isFailure(exit)) manager.poison(exit.cause);
              }),
            ),
          );

          return yield* restore(
            Effect.gen(function* () {
              const config = yield* connectionConfig(
                endpoint,
                address,
                "sentinel",
                policy,
                options,
              );
              const connection = yield* makeConnection(config, {
                ...options.sentinelConnection,
                reconnectAttempts: 1,
              }).pipe(Effect.mapError((error) => discoveryFailure("sentinel", error)));
              writing();
              // A failed control mutation keeps native unknown-outcome evidence; only acquisition is translated.
              return yield* connection.executeOrdinary(tokens);
            }).pipe(
              Effect.provideContext(Context.add(captured, Scope.Scope, scope)),
              Effect.provideService(RoleExpectation, undefined),
            ),
          ).pipe(Effect.ensuring(close));
        }),
      ),
    );

  return (index: number): RedisExecutor => {
    const executor: RedisExecutor = {
      execute: (command) =>
        command.prepare.pipe(Effect.flatMap((intent) => executor.executePrepared(intent))),
      executePrepared: (intent) =>
        Effect.gen(function* () {
          yield* manager.check();
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

          const reply = yield* request(endpoint, intent.tokens);
          return yield* decodeReply(intent, reply);
        }),
    };
    return executor;
  };
});
