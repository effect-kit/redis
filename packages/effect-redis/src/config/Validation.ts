import { Effect, Schema, SchemaIssue } from "effect";

import { RedisConfigError } from "#/errors/RedisConfigError";

export const PositiveInteger = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);

export const NonNegativeInteger = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);

const safeIssues = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: () => "Invalid value or option",
  checkHook: () => "Invalid value or option combination",
});

const fields = new Set([
  "endpoint",
  "url",
  "host",
  "port",
  "path",
  "tls",
  "serverName",
  "ca",
  "certificate",
  "privateKey",
  "rejectUnauthorized",
  "credentials",
  "username",
  "password",
  "database",
  "clientName",
  "protocol",
  "connectTimeoutMillis",
  "commandTimeoutMillis",
  "limits",
  "reconnectAttempts",
  "reconnectDelayMillis",
  "shutdownTimeoutMillis",
  "maxPushMessages",
  "maxPushBytes",
  "maxHeaderBytes",
  "maxBlobBytes",
  "maxBufferedBytes",
  "maxAggregateEntries",
  "maxNestingDepth",
  "maxQueuedCommands",
  "maxInFlightCommands",
  "maxQueuedBytes",
  "maxInFlightBytes",
]);

export const decode = <S extends Schema.Constraint>(schema: S, field: string, input: unknown) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError((error) => {
      const issue = safeIssues(error.issue).issues[0];
      // Unexpected keys are untrusted too; only schema-owned path segments may escape.
      const path = issue?.path?.filter((part) => typeof part === "string" && fields.has(part));
      return new RedisConfigError({
        field: path?.length ? `${field}.${path.join(".")}` : field,
        reason: "Invalid value or option combination",
      });
    }),
  );
