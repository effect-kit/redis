import { Effect, Redacted, Schema } from "effect";

import { RedisConfigError } from "../errors/RedisConfigError.js";
import { decode, NonNegativeInteger } from "./Validation.js";

const Host = Schema.NonEmptyString.check(
  Schema.isPattern(/^[^\s/@?#]+$/),
  Schema.makeFilter((host) => !host.includes("\0")),
);
const Secret = Schema.RedactedFromValue(Schema.String);
const TlsSecret = Schema.RedactedFromValue(Schema.NonEmptyString);

export const Credentials = Schema.Struct({
  username: Schema.optionalKey(Secret),
  password: Secret,
});

export const TlsOptions = Schema.Struct({
  serverName: Schema.optionalKey(Host),
  ca: Schema.optionalKey(TlsSecret),
  certificate: Schema.optionalKey(TlsSecret),
  privateKey: Schema.optionalKey(TlsSecret),
  rejectUnauthorized: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
}).check(
  Schema.makeFilter((tls) => (tls.certificate === undefined) === (tls.privateKey === undefined)),
);

const TcpEndpoint = Schema.Struct({
  host: Host,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(6379)),
  ),
  tls: Schema.optionalKey(TlsOptions),
});
const UnixEndpoint = Schema.Struct({
  path: Schema.NonEmptyString.check(
    Schema.isPattern(/^\//),
    Schema.makeFilter((path) => !path.includes("\0")),
  ),
});
const UrlEndpoint = Schema.Struct({
  url: Schema.String.check(Schema.makeFilter((url) => !/\s/.test(url) && !url.includes("\0"))),
  tls: Schema.optionalKey(TlsOptions),
});

export const EndpointInput = Schema.Union([TcpEndpoint, UnixEndpoint, UrlEndpoint]);
export type Endpoint =
  | {
      readonly _tag: "Tcp";
      readonly host: string;
      readonly port: number;
      readonly tls?: typeof TlsOptions.Type;
    }
  | { readonly _tag: "Unix"; readonly path: string };

const RedisUrl = Schema.URLFromString.check(
  Schema.makeFilter(
    (url) =>
      ["redis:", "rediss:"].includes(url.protocol) &&
      url.hostname.length > 0 &&
      url.search === "" &&
      url.hash === "" &&
      /^(\/\d*)?$/.test(url.pathname),
  ),
);

export const normalizeEndpoint = Effect.fnUntraced(function* (input: typeof EndpointInput.Type) {
  if ("path" in input) return { endpoint: { _tag: "Unix", path: input.path } as const };
  if ("host" in input) return { endpoint: { _tag: "Tcp", ...input } as const };
  const url = yield* decode(RedisUrl, "endpoint.url", input.url);
  if (url.protocol === "redis:" && input.tls !== undefined) {
    return yield* new RedisConfigError({
      field: "endpoint.tls",
      reason: "Use rediss: for TLS URLs",
    });
  }
  const credentials =
    url.username !== "" || url.password !== ""
      ? yield* Effect.try({
          try: () => ({
            ...(url.username !== ""
              ? { username: Redacted.make(decodeURIComponent(url.username)) }
              : {}),
            password: Redacted.make(decodeURIComponent(url.password)),
          }),
          catch: () =>
            new RedisConfigError({ field: "endpoint.url", reason: "Invalid credential encoding" }),
        })
      : undefined;
  const database =
    url.pathname.length > 1
      ? yield* decode(NonNegativeInteger, "endpoint.url.database", Number(url.pathname.slice(1)))
      : undefined;
  const endpoint: Endpoint = {
    _tag: "Tcp",
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port === "" ? 6379 : Number(url.port),
    ...(url.protocol === "rediss:" ? { tls: input.tls ?? { rejectUnauthorized: true } } : {}),
  };
  if (endpoint.port === 0)
    return yield* new RedisConfigError({ field: "endpoint.url", reason: "Port must be positive" });
  return { endpoint, credentials, database };
});
