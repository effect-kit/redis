import { Effect, Redacted, Schema } from "effect";

import { ProfileError } from "#/errors/ProfileError";
import { TransportError } from "#/errors/TransportError";
import type { RedisConfig } from "#/RedisConfig";
import type { Transport } from "#/transport/Transport";

const Host = Schema.NonEmptyString.check(
  Schema.isMaxLength(253),
  Schema.isPattern(/^[^\s/@?#*]+$/),
);
const NetworkPolicy = Schema.Struct({
  allowedHosts: Schema.NonEmptyArray(Host).check(Schema.isMaxLength(1024)),
  allowedServerNames: Schema.optionalKey(
    Schema.NonEmptyArray(Host).check(Schema.isMaxLength(1024)),
  ),
});
export type NetworkPolicy = typeof NetworkPolicy.Type;

export const decodeNetworkPolicy = (input: unknown) =>
  Schema.decodeUnknownEffect(NetworkPolicy, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError(() => new ProfileError({ delivery: "unsent", reason: "network-policy" })),
  );

const normalized = (host: string) => host.toLowerCase().replace(/^\[|\]$/g, "");

export const networkGuard = (policy?: NetworkPolicy) => {
  const hosts = policy === undefined ? undefined : new Set(policy.allowedHosts.map(normalized));
  const identities =
    policy?.allowedServerNames === undefined
      ? undefined
      : new Set(policy.allowedServerNames.map(normalized));
  return (config: Pick<RedisConfig, "endpoint">) => {
    if (hosts === undefined) return undefined;
    const endpoint = config.endpoint;
    if (endpoint._tag !== "Tcp" || !hosts.has(normalized(endpoint.host)))
      return new ProfileError({ delivery: "unsent", reason: "network-policy" });
    const identity = endpoint.tls?.serverName ?? endpoint.host;
    if (identities !== undefined && !identities.has(normalized(identity)))
      return new ProfileError({ delivery: "unsent", reason: "network-policy" });
    return undefined;
  };
};

/** Check each translated/discovered dial before opening a socket or acquiring its credentials. */
export const restrictedTransport = (
  transport: Transport["Service"],
  policy?: NetworkPolicy,
): Transport["Service"] => {
  const guard = networkGuard(policy);
  return {
    open: (config) =>
      Effect.suspend(() => {
        const error = guard(config);
        return error === undefined
          ? transport.open(config)
          : Effect.fail(
              new TransportError({ stage: "open", reason: "policy", cause: Redacted.make(error) }),
            );
      }),
  };
};
