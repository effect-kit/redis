import { Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http/HttpClientRequest";

export const httpConfig = {
  url: "https://redis.example.test",
  token: Redacted.make("fixture-bearer"),
};

export const controlledHttp = (
  respond: (request: HttpClientRequest, signal: AbortSignal) => Effect.Effect<Response>,
) => {
  const requests: Array<HttpClientRequest> = [];
  const client = HttpClient.make((request, _url, signal) => {
    requests.push(request);
    return respond(request, signal).pipe(
      Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
    );
  });

  return { requests, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

export const resp = (body: string | Uint8Array, status = 200) =>
  Effect.succeed(
    new Response(body, { status, headers: { "content-type": "application/octet-stream" } }),
  );

export const json = (body: string, status = 200) =>
  Effect.succeed(new Response(body, { status, headers: { "content-type": "application/json" } }));

export const requestText = (request: HttpClientRequest) =>
  request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : undefined;
