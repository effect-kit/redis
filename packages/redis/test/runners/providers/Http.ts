import { Effect, Redacted } from "effect";

import { Redis, RedisProfiles } from "@effect-kit/redis";
import { RedisUpstash } from "@effect-kit/redis/upstash";

import { assertions, ensure } from "#test/runners/providers/scenarios/Assertions";
import { batches } from "#test/runners/providers/scenarios/Batches";
import { collections } from "#test/runners/providers/scenarios/Collections";
import { data } from "#test/runners/providers/scenarios/Data";
import { events } from "#test/runners/providers/scenarios/Events";
import { extensions } from "#test/runners/providers/scenarios/Extensions";
import { identity } from "#test/runners/providers/scenarios/Identity";
import { ownedKeys } from "#test/runners/providers/scenarios/OwnedKeys";
import type { HttpInput, Receipt, Runtime } from "#test/support/providers/Contract";

/** The same compiled public HTTP client and scenarios execute in every portable runtime. */
export const runHttp = (input: HttpInput, runtime: Runtime, runtimeVersion: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const redis = yield* Redis;
      const test = assertions();
      const keys = ownedKeys(input.prefix);
      const server = yield* identity(redis, input.prefix, test);
      const observations = yield* Effect.scoped(
        Effect.gen(function* () {
          // Own exact-key cleanup before the first write; never scan or flush a hosted database.
          yield* Effect.addFinalizer(() => redis.del(keys).pipe(Effect.orDie));

          switch (input.scenario) {
            case "data":
              yield* data(redis, input.prefix, test);
              break;
            case "collections":
              yield* collections(redis, input.prefix, test, "http");
              break;
            case "batches":
              yield* batches(redis, input.prefix, test, "http");
              break;
            case "events":
              yield* events(redis, input.prefix, test);
              break;
            case "extensions":
              yield* extensions(redis, input.prefix, test);
              break;
          }

          return test.observations;
        }),
      );
      const [first, ...rest] = observations;
      ensure(first !== undefined, "empty-observations");
      return {
        provider: runtime === "workers" ? "workers" : "upstash-http",
        runtime,
        runtimeVersion,
        protocol: "http",
        scenario: input.scenario,
        profile: "upstash.http",
        server,
        observations: [first, ...rest],
        cleanup: true,
      } satisfies Receipt;
    }).pipe(
      Effect.provide(
        RedisUpstash.layer({
          url: input.url,
          token: Redacted.make(input.token),
          profile: RedisProfiles.upstash({ transport: "http" }),
          requestTimeoutMillis: 15_000,
          streamHandshakeTimeoutMillis: 15_000,
          maxConcurrentRequests: 4,
          maxBatchCommands: 16,
          maxResponseBytes: 1024 * 1024,
        }),
      ),
    ),
  );
