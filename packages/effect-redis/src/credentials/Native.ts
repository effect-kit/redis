import { Context, Effect, Layer, Redacted } from "effect";

import { makeCredentialBindings } from "#/credentials/Bindings";
import type { CredentialBindings } from "#/credentials/Bindings";
import { decodeCredentialLifetime } from "#/credentials/Lifetime";
import type { CredentialLifetime } from "#/credentials/Lifetime";
import { makeCredentialManager, RedisCredentials } from "#/credentials/Manager";
import type { CredentialProvider } from "#/credentials/Provider";
import { CredentialError } from "#/errors/CredentialError";
import { HandshakeError } from "#/errors/HandshakeError";
import { commandPolicy, ProfileCommandPolicy } from "#/profiles/Commands";
import { restrictedTransport } from "#/profiles/Network";
import type { NetworkPolicy } from "#/profiles/Network";
import type { DeploymentProfile } from "#/profiles/Profile";
import { Transport } from "#/transport/Transport";

export const makeNativeCredentials = Effect.fnUntraced(function* <R>(
  source: CredentialProvider<R>,
  lifetime?: CredentialLifetime,
  registry?: CredentialBindings,
  deployment: {
    readonly profile?: DeploymentProfile | undefined;
    readonly network?: NetworkPolicy | undefined;
    readonly plane?: "data" | "sentinel";
  } = {},
) {
  const policy = yield* decodeCredentialLifetime(lifetime ?? { mode: "reconnect" });
  const manager = yield* makeCredentialManager({
    ...source,
    policy: {
      ...source.policy,
      // A cached token must outlive this generation's deliberate retirement margin.
      refreshBeforeMillis: Math.max(
        source.policy.refreshBeforeMillis ?? 60_000,
        policy.mode === "token-expiry" ? policy.retireBeforeMillis : 0,
      ),
    },
  });
  const bindings =
    registry ??
    (yield* makeCredentialBindings(restrictedTransport(yield* Transport, deployment.network)));
  const owner = Symbol();
  const credentials = Effect.gen(function* () {
    yield* bindings.claim(owner, deployment.plane);
    const snapshot = yield* manager.get;
    const auth = deployment.profile?.authentication;
    if (
      auth !== undefined &&
      ["password", "iam", "entra", "bearer"].includes(auth) &&
      snapshot.credentials === undefined
    )
      return yield* new CredentialError({ reason: "configuration" });
    if (auth === "iam" || auth === "entra") {
      if (snapshot.credentials?.expiresAtMillis === undefined)
        return yield* new CredentialError({ reason: "configuration" });
      if (
        (auth === "entra" || deployment.profile?.id.startsWith("aws-")) &&
        snapshot.credentials.username === undefined
      )
        return yield* new CredentialError({ reason: "configuration" });
    }
    if (snapshot.revision !== manager.revision())
      return yield* new CredentialError({ reason: "rotated" });
    return yield* bindings.bind(snapshot, policy, owner, deployment.plane);
  }).pipe(
    Effect.mapError(
      (cause) =>
        new HandshakeError({
          stage: "credentials",
          reason: "unavailable",
          delivery: "unsent",
          cause: Redacted.make(cause),
        }),
    ),
  );
  const rotate = Effect.gen(function* () {
    const retiring = bindings.sockets(owner);
    yield* manager.invalidate;
    yield* Effect.forEach(retiring, (socket) => socket.close, {
      concurrency: 8,
      discard: true,
    }).pipe(
      Effect.mapError(
        (cause) => new CredentialError({ reason: "retirement", cause: Redacted.make(cause) }),
      ),
    );
  }).pipe(Effect.uninterruptible);
  const identity = { ...manager, rotate };

  return {
    credentials,
    identity,
    bindings,
    infrastructure: Layer.succeedContext(
      Context.make(Transport, bindings.transport).pipe(
        Context.add(RedisCredentials, identity),
        Context.add(ProfileCommandPolicy, commandPolicy(deployment.profile)),
      ),
    ),
  };
});
