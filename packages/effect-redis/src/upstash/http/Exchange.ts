import { Effect, Redacted, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import type { HttpClientResponse } from "effect/http/HttpClientResponse";

import { UpstashError } from "#/errors/UpstashError";
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
    }),
  );
};

export const readBody = (response: HttpClientResponse, maximum: number) =>
  Effect.gen(function* () {
    const chunks: Array<Uint8Array> = [];
    let length = 0;

    yield* response.stream.pipe(
      Stream.mapError(responseError),
      Stream.runForEach((chunk) =>
        Effect.suspend(() => {
          if (chunk.length > maximum - length)
            return Effect.fail(
              new UpstashError({ stage: "response", reason: "limit", delivery: "unknown" }),
            );
          chunks.push(new Uint8Array(chunk));
          length += chunk.length;
          return Effect.void;
        }),
      ),
    );

    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  });
