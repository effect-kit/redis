import { expect, it } from "@effect/vitest";
import { Effect, Stream } from "effect";

import { makeRedisPubSub } from "#/index";
import { layer } from "#/node";
import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { recordFixture } from "#test/support/servers/Evidence";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "PUBSUB-LIVE: $target.fixture $protocol acknowledged shared, pattern and shard interests",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { config, redis, prefix, server } = yield* sessionBackend(target, protocol);
      const pubsub = yield* makeRedisPubSub(config).pipe(Effect.provide(layer));
      const channel = `${prefix}:channel`;
      const first = yield* pubsub.subscribe([channel]);
      const second = yield* pubsub.subscribe([channel]);
      const binary = new Uint8Array([0, 255, 128]);

      expect(yield* redis.pubsubNumSub([channel])).toEqual([[bytes(channel), 1n]]);
      expect(yield* redis.pubsubChannels(`${prefix}:*`)).toEqual([bytes(channel)]);
      expect(yield* redis.publish(channel, binary)).toBe(1n);
      expect(yield* Stream.runCollect(first.messages.pipe(Stream.take(1)))).toMatchObject([
        { _tag: "Message", payload: binary },
      ]);
      expect(yield* Stream.runCollect(second.messages.pipe(Stream.take(1)))).toMatchObject([
        { payload: binary },
      ]);

      const pattern = yield* pubsub.psubscribe([`${prefix}:*`]);
      expect(yield* redis.pubsubNumPat()).toBe(1n);
      expect(yield* redis.publish(channel, "overlap")).toBe(2n);
      expect(yield* Stream.runCollect(pattern.messages.pipe(Stream.take(1)))).toMatchObject([
        {
          _tag: "PatternMessage",
          pattern: bytes(`${prefix}:*`),
          channel: bytes(channel),
          payload: bytes("overlap"),
        },
      ]);
      expect(yield* redis.pubsubHelp()).not.toHaveLength(0);

      yield* first.close();
      expect(yield* redis.pubsubNumSub([channel])).toEqual([[bytes(channel), 1n]]);
      yield* second.close();
      yield* pattern.close();
      expect(yield* redis.pubsubNumSub([channel])).toEqual([[bytes(channel), 0n]]);

      const shard = `${prefix}:shard`;
      if (atLeast(target.version, "7.0.0")) {
        const subscription = yield* pubsub.ssubscribe([shard]);
        expect(yield* redis.pubsubShardChannels(`${prefix}:*`)).toEqual([bytes(shard)]);
        expect(yield* redis.pubsubShardNumSub([shard])).toEqual([[bytes(shard), 1n]]);
        expect(yield* redis.spublish(shard, binary)).toBe(1n);
        expect(yield* Stream.runCollect(subscription.messages.pipe(Stream.take(1)))).toMatchObject([
          { _tag: "ShardMessage", payload: binary },
        ]);
        yield* subscription.close();
      } else {
        expect(yield* Effect.flip(pubsub.ssubscribe([shard]))).toMatchObject({
          _tag: "ServerError",
        });
        expect(yield* Effect.flip(redis.spublish(shard, binary))).toMatchObject({
          _tag: "ServerError",
        });
        expect(yield* Effect.flip(redis.pubsubShardChannels())).toMatchObject({
          _tag: "ServerError",
        });
      }

      yield* recordFixture(`pubsub-${target.fixture}-${protocol}`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        protocol,
        build: server.build,
        configurationDigest: server.configurationDigest,
        scenarios: [
          "shared-interest",
          "pattern-overlap",
          "binary-publication",
          "shard-availability",
          "unsubscribe",
        ],
      });
    }),
);
