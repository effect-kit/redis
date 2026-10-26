import { Context, Effect, Redacted } from "effect";

import type { CredentialBindings } from "#/credentials/Bindings";
import type { CredentialManager } from "#/credentials/Manager";
import { CredentialError } from "#/errors/CredentialError";

export const sentinelCredentialService = (
  bindings: CredentialBindings,
  manager?: CredentialManager,
) => ({
  rotate: Effect.gen(function* () {
    const sockets = bindings.plane("sentinel");
    if (manager !== undefined) yield* manager.invalidate;
    yield* Effect.forEach(sockets, (socket) => socket.close, {
      concurrency: 8,
      discard: true,
    }).pipe(
      Effect.mapError(
        (cause) => new CredentialError({ reason: "retirement", cause: Redacted.make(cause) }),
      ),
    );
  }).pipe(Effect.uninterruptible),
  snapshot: Effect.gen(function* () {
    return {
      connections: bindings.plane("sentinel").length,
      managed: manager !== undefined,
      coordinator: manager === undefined ? undefined : yield* manager.snapshot,
    };
  }),
});

export class RedisSentinelCredentials extends Context.Service<
  RedisSentinelCredentials,
  ReturnType<typeof sentinelCredentialService>
>()("@effect-kit/redis/RedisSentinelCredentials") {}
