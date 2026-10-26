import { Effect, Fiber, Option, Semaphore } from "effect";
import type { Scope } from "effect";
import { HttpClient } from "effect/http";

import type { PreparedCommand } from "#/command/Command";
import { UpstashError } from "#/errors/UpstashError";
import type { UpstashConfig } from "#/upstash/Config";
import { encodeRequest } from "#/upstash/encoding/Request";
import { decodeJsonBatch, decodeResp, envelope, responseJson } from "#/upstash/encoding/Response";
import { jsonReplyPolicy } from "#/upstash/encoding/Status";
import { checkStatus, exchange, readBody } from "#/upstash/http/Exchange";

export const makeHttpClient = Effect.fnUntraced(function* (config: UpstashConfig) {
  const client = yield* HttpClient.HttpClient;
  const owner = yield* Effect.scope;
  const semaphore = yield* Semaphore.make(config.maxConcurrentRequests);
  let closed = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }),
  );

  const run = <A, E>(operation: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.suspend(() => {
      if (closed)
        return Effect.fail(
          new UpstashError({ stage: "request", reason: "closed", delivery: "unsent" }),
        );

      const limited = semaphore
        .withPermitsIfAvailable(1)(Effect.scoped(operation))
        .pipe(
          Effect.flatMap((result) =>
            Option.isSome(result)
              ? Effect.succeed(result.value)
              : Effect.fail(
                  new UpstashError({ stage: "request", reason: "capacity", delivery: "unsent" }),
                ),
          ),
        );
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          // The service scope and caller both own cancellation; no detached fetch survives either.
          const fiber = yield* Effect.forkIn(restore(limited), owner);
          return yield* restore(Fiber.join(fiber)).pipe(Effect.ensuring(Fiber.interrupt(fiber)));
        }),
      );
    });

  const request = Effect.fnUntraced(function* (
    commands: ReadonlyArray<PreparedCommand<unknown, unknown, unknown>>,
    mode: "ordinary" | "pipeline" | "transaction",
  ) {
    // Later caller mutation cannot change how JSON's erased wire types are reconstructed.
    const policies = commands.map(jsonReplyPolicy);
    const body = yield* encodeRequest(commands, mode, config);
    return yield* run(
      Effect.gen(function* () {
        const response = yield* exchange(client, config, body, mode === "transaction");
        const bytes = yield* readBody(response, config.maxResponseBytes);
        const mediaType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();

        // Redis rejections use HTTP400 too. Preserve their actual reply instead of collapsing status/error domains.
        if (response.status === 400 && mediaType === "application/json") {
          const value = yield* responseJson(bytes, config);
          const reply = yield* Effect.try({
            try: () => envelope(value),
            catch: () =>
              new UpstashError({ stage: "response", reason: "malformed", delivery: "unknown" }),
          });
          if (reply._tag !== "SimpleError")
            return yield* new UpstashError({
              stage: "response",
              reason: "malformed",
              delivery: "unknown",
            });
          return { _tag: "Rejected" as const, reply };
        }
        if (response.status === 400 && mediaType === "application/octet-stream") {
          const [reply] = yield* decodeResp(bytes, 1, config);
          if (reply?._tag !== "SimpleError" && reply?._tag !== "BlobError")
            return yield* new UpstashError({
              stage: "response",
              reason: "malformed",
              delivery: "unknown",
            });
          return { _tag: "Rejected" as const, reply };
        }

        yield* checkStatus(response);
        if (mode === "transaction") {
          if (mediaType !== "application/json")
            return yield* new UpstashError({
              stage: "response",
              reason: "malformed",
              delivery: "unknown",
            });
          const replies = yield* decodeJsonBatch(yield* responseJson(bytes, config), policies);
          if (replies.length !== commands.length)
            return yield* new UpstashError({
              stage: "response",
              reason: "malformed",
              delivery: "unknown",
            });
          return { _tag: "Replies" as const, replies };
        }

        if (mediaType !== "application/octet-stream")
          return yield* new UpstashError({
            stage: "response",
            reason: "malformed",
            delivery: "unknown",
          });
        return {
          _tag: "Replies" as const,
          replies: yield* decodeResp(bytes, commands.length, config),
        };
      }).pipe(
        Effect.timeoutOrElse({
          duration: config.requestTimeoutMillis,
          orElse: () =>
            Effect.fail(
              new UpstashError({ stage: "request", reason: "timeout", delivery: "unknown" }),
            ),
        }),
      ),
    );
  });

  return { request, run, client, config };
});

export type UpstashHttpClient = Effect.Success<ReturnType<typeof makeHttpClient>>;
