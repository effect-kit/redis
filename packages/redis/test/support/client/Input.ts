import { Redacted } from "effect";

import type { NativeClientInput } from "#/client/Input";
import type { RedisConfig, RedisConfigInput } from "#/RedisConfig";

/** Convert owned fixture configuration without making built-artifact runners import source at runtime. */
export const nativeInput = (
  config: RedisConfig,
): NativeClientInput & { readonly endpoint: RedisConfigInput["endpoint"] } => {
  const { endpoint, ...settings } = config;
  if (endpoint._tag === "Unix") return { ...settings, endpoint: { path: endpoint.path } };
  const tls = endpoint.tls;
  return {
    ...settings,
    endpoint: {
      host: endpoint.host,
      port: endpoint.port,
      ...(tls === undefined
        ? {}
        : {
            tls: {
              rejectUnauthorized: tls.rejectUnauthorized,
              ...(tls.serverName === undefined ? {} : { serverName: tls.serverName }),
              ...(tls.ca === undefined ? {} : { ca: Redacted.value(tls.ca) }),
              ...(tls.certificate === undefined
                ? {}
                : { certificate: Redacted.value(tls.certificate) }),
              ...(tls.privateKey === undefined
                ? {}
                : { privateKey: Redacted.value(tls.privateKey) }),
            },
          }),
    },
  };
};
