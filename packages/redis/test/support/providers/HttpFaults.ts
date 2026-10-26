import { Effect, Option, Redacted } from "effect";

import { BatchError, Commands, Redis, UpstashError } from "@effect-kit/redis";
import type { RedisClient } from "@effect-kit/redis";
import { RedisUpstash } from "@effect-kit/redis/upstash";

import { ensure } from "#test/runners/providers/scenarios/Assertions";
import type { HttpInput, Observation } from "#test/support/providers/Contract";
import { httpServer, requestBody } from "#test/support/upstash/HttpServer";

/** Drop replies only after the real hosted backend answered; independently prove each mutation ran once. */
export const hostedHttpFaults = Effect.fnUntraced(function* (
  input: HttpInput,
  oracle: RedisClient,
) {
  const observations: Observation[] = [];
  let forwarded = 0;
  const proxy = yield* httpServer(async (request, response, signal) => {
    ensure(["/", "/pipeline", "/multi-exec"].includes(request.url ?? ""), "fault-proxy-path");
    const body = await requestBody(request);
    const upstream = await fetch(input.url + (request.url === "/" ? "" : request.url), {
      method: "POST",
      signal,
      redirect: "error",
      body,
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
        ...(request.url === "/multi-exec"
          ? { "upstash-encoding": "base64" }
          : { "upstash-response-format": "resp2" }),
      },
    });
    await upstream.arrayBuffer();
    ensure(upstream.ok, "fault-proxy-upstream");
    forwarded++;
    response.destroy();
  });
  const key = `${input.prefix}uncertain`;
  yield* oracle.set(key, "0", { expiry: { type: "EX", value: 300 } });
  yield* Effect.gen(function* () {
    const redis = yield* Redis;
    const single = yield* Effect.result(redis.incr(key));
    ensure(
      single._tag === "Failure" &&
        single.failure instanceof UpstashError &&
        single.failure.delivery === "unknown",
      "hosted-single-unknown",
    );
    ensure(Option.getOrUndefined(yield* oracle.get(key)) === "1", "hosted-single-once");
    observations.push({ id: "faults.single-no-replay", outcome: "passed" });

    const pipeline = yield* Effect.result(redis.pipeline([Commands.incr(key)]));
    ensure(
      pipeline._tag === "Failure" &&
        pipeline.failure instanceof BatchError &&
        pipeline.failure.execution === "unknown",
      "hosted-pipeline-unknown",
    );
    ensure(Option.getOrUndefined(yield* oracle.get(key)) === "2", "hosted-pipeline-once");
    observations.push({ id: "faults.pipeline-no-replay", outcome: "passed" });

    const transaction = yield* Effect.result(redis.transaction([Commands.incr(key)]));
    ensure(
      transaction._tag === "Failure" &&
        transaction.failure instanceof BatchError &&
        transaction.failure.execution === "unknown",
      "hosted-transaction-unknown",
    );
    ensure(Option.getOrUndefined(yield* oracle.get(key)) === "3", "hosted-transaction-once");
    ensure(forwarded === 3, "hosted-request-count");
    observations.push({ id: "faults.transaction-no-replay", outcome: "passed" });
  }).pipe(
    Effect.scoped,
    Effect.provide(
      RedisUpstash.layer({
        url: proxy.url,
        token: Redacted.make(input.token),
        allowInsecureLocalhost: true,
        requestTimeoutMillis: 10_000,
      }),
    ),
  );

  const denied = yield* Effect.result(
    Effect.gen(function* () {
      return yield* (yield* Redis).ping();
    }).pipe(
      Effect.scoped,
      Effect.provide(
        RedisUpstash.layer({
          url: input.url,
          token: Redacted.make("deliberately-invalid-phase18-token"),
          requestTimeoutMillis: 10_000,
        }),
      ),
    ),
  );
  ensure(
    denied._tag === "Failure" &&
      denied.failure instanceof UpstashError &&
      denied.failure.reason === "authentication",
    "hosted-authentication-rejected",
  );
  observations.push({ id: "faults.invalid-bearer-rejected", outcome: "passed" });
  yield* oracle.del([key]);
  return observations;
});
