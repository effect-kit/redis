import { Redacted } from "effect";

import type { RedisConfig } from "#/RedisConfig";

/** Child input uses configuration input values, not normalized tags or Redacted JSON placeholders. */
export const runtimeConfig = (config: RedisConfig) => {
  const endpoint = config.endpoint;
  const tls = endpoint._tag === "Tcp" ? endpoint.tls : undefined;

  return {
    endpoint:
      endpoint._tag === "Unix"
        ? { path: endpoint.path }
        : {
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
    protocol: config.protocol,
    database: config.database,
    connectTimeoutMillis: config.connectTimeoutMillis,
    commandTimeoutMillis: config.commandTimeoutMillis,
    limits: config.limits,
    ...(config.clientName === undefined ? {} : { clientName: config.clientName }),
    ...(config.credentials === undefined
      ? {}
      : {
          credentials: {
            password: Redacted.value(config.credentials.password),
            ...(config.credentials.username === undefined
              ? {}
              : { username: Redacted.value(config.credentials.username) }),
          },
        }),
  };
};
