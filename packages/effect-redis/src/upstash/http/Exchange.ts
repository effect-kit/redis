import { Effect, Redacted, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import type { HttpClientResponse } from "effect/http/HttpClientResponse";

import { UpstashError } from "#/errors/UpstashError";
import { ByteBuilder } from "#/protocol/decode/buffers";
import type { UpstashConfig } from "#/upstash/Config";
import type { HttpRequestBody } from "#/upstash/encoding/Request";

export const requestError = () =>
  new UpstashError({ stage: "request", reason: "network", delivery: "unknown" });
export const responseError = () =>
  new UpstashError({ stage: "response", reason: "network", delivery: "unknown" });

/** Fetch must expose redirects for inspection; body-form keys must not enter automatic HTTP spans. */
export const exchange = (
  client: HttpClient.HttpClient,
  config: UpstashConfig,
  body: HttpRequestBody,
  json: boolean,
) =>
  HttpClient.withScope(client)
    .execute(
      HttpClientRequest.post(config.url + body.path).pipe(
        HttpClientRequest.setHeaders({
          authorization: `Bearer ${Redacted.value(config.token)}`,
          "content-type": body.contentType,
          ...(json ? { "upstash-encoding": "base64" } : { "upstash-response-format": "resp2" }),
        }),
        HttpClientRequest.bodyUint8Array(body.body, body.contentType),
      ),
    )
    .pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual", cache: "no-store" }),
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.mapError(requestError),
    );

export const checkStatus = (response: HttpClientResponse) => {
  const status = response.status;
  if (status >= 200 && status < 300) return Effect.void;
  const retryAfter = response.headers["retry-after"];
  const seconds =
    retryAfter !== undefined && /^[0-9]{1,9}$/.test(retryAfter) ? Number(retryAfter) : undefined;
  return Effect.fail(
    new UpstashError({
      stage: "response",
      reason:
        status === 401 || status === 403
          ? "authentication"
          : status === 429
            ? "rate-limit"
            : "status",
      delivery: "unknown",
      status,
      ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }),
    }),
  );
};

export const readBody = (response: HttpClientResponse, maximum: number) =>
  Effect.gen(function* () {
    const body = new ByteBuilder(Math.min(4096, maximum));

    yield* response.stream.pipe(
      Stream.mapError(responseError),
      Stream.runForEach((chunk) =>
        Effect.suspend(() => {
          if (chunk.length > maximum - body.length)
            return Effect.fail(
              new UpstashError({ stage: "response", reason: "limit", delivery: "unknown" }),
            );
          // Fixed blocks also bound allocation count when an HTTP peer sends one-byte chunks.
          body.append(chunk);
          return Effect.void;
        }),
      ),
    );

    return body.finish();
  });
