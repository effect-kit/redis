import { Effect, Fiber, Option, Redacted, Stream } from "effect";

import { Commands, Redis, RedisProfiles, RedisPubSub, RedisSessions } from "@effect-kit/redis";

import type { NativeClientInput } from "#/client/Input";
import type { RedisNode } from "#/node";
import { assertions, ensure, sameBytes, utf8 } from "#test/runners/providers/scenarios/Assertions";
import { batches } from "#test/runners/providers/scenarios/Batches";
import { collections } from "#test/runners/providers/scenarios/Collections";
import { data } from "#test/runners/providers/scenarios/Data";
import { extensions } from "#test/runners/providers/scenarios/Extensions";
import { identity } from "#test/runners/providers/scenarios/Identity";
import { ownedKeys } from "#test/runners/providers/scenarios/OwnedKeys";
import { assertUnsubscribed } from "#test/runners/providers/scenarios/Subscriptions";
import type { NativeInput, Receipt, Runtime } from "#test/support/providers/Contract";

export const nativeProfile = (provider: NativeInput["provider"]) => {
  if (provider === "upstash-native") return RedisProfiles.upstash({ transport: "native" });
  if (provider === "aiven") return RedisProfiles.aivenValkey({ user: "default" });
  return RedisProfiles.redisCloud({ plan: "free", routing: "proxy", authentication: "password" });
};

export const nativeSettings = (input: NativeInput): NativeClientInput => ({
  endpoint: { url: input.url, ...(input.ca === undefined ? {} : { tls: { ca: input.ca } }) },
  protocol: input.protocol,
  connectTimeoutMillis: 10_000,
  commandTimeoutMillis: 15_000,
  profile: nativeProfile(input.provider),
});

export const runNative = (
  input: NativeInput,
  layer: typeof RedisNode.layer,
  runtime: Runtime,
  runtimeVersion: string,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const redis = yield* Redis;
      const sessions = yield* RedisSessions;
      const subscriptions = yield* RedisPubSub;
      const test = assertions();
      const server = yield* identity(redis, input.prefix, test);
      const observations = yield* Effect.scoped(
        Effect.gen(function* () {
          const keys = ownedKeys(input.prefix);
          yield* Effect.addFinalizer(() => redis.del(keys).pipe(Effect.orDie));

          yield* data(redis, input.prefix, test);
          yield* collections(redis, input.prefix, test);
          yield* batches(redis, input.prefix, test, "native");
          if (input.provider === "upstash-native") {
            yield* extensions(redis, input.prefix, test);
            const endpoint = new URL(input.url);
            yield* test.check(
              "native.rest-token",
              redis.upstash.aclRestToken(
                Redacted.make(decodeURIComponent(endpoint.username) || "default"),
                Redacted.make(decodeURIComponent(endpoint.password)),
              ),
              (token) => ensure(Redacted.value(token).length > 0, "rest-token"),
            );
          }
          yield* test.check(
            "native.watch",
            sessions.watch([`${input.prefix}batch`], (session) =>
              session.transaction([Commands.get(`${input.prefix}batch`)]),
            ),
            (reply) => ensure(reply._tag === "Committed", "watch"),
          );

          const channel = `${input.prefix}channel`;
          const subscription = yield* subscriptions.subscribe([channel]);
          const receiving = yield* subscription.messages.pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkChild,
          );
          yield* test.check("native.publish", redis.publish(channel, "hosted-message"), (reply) =>
            ensure(reply >= 1n, "native-publish"),
          );
          const messages = yield* Fiber.join(receiving).pipe(Effect.timeout(10_000));
          ensure(
            messages.length === 1 &&
              sameBytes(messages[0]?.channel, utf8(channel)) &&
              sameBytes(messages[0]?.payload, utf8("hosted-message")),
            "native-message",
          );
          yield* subscription.close();
          yield* assertUnsubscribed(redis, channel);
          test.record("native.subscription-close");

          yield* test.check("native.delete", redis.del([`${input.prefix}batch`]), (reply) =>
            ensure(reply === 1n, "delete"),
          );
          yield* test.check(
            "native.missing-after-delete",
            redis.get(`${input.prefix}batch`),
            (reply) => ensure(Option.isNone(reply), "missing-after-delete"),
          );
          return test.observations;
        }),
      );

      const [first, ...rest] = observations;
      ensure(first !== undefined, "empty-observations");
      return {
        provider: input.provider,
        runtime,
        runtimeVersion,
        protocol: input.protocol,
        scenario: "native",
        profile: nativeProfile(input.provider).id,
        server,
        observations: [first, ...rest],
        cleanup: true,
      } satisfies Receipt;
    }).pipe(Effect.provide(layer(nativeSettings(input)))),
  );
