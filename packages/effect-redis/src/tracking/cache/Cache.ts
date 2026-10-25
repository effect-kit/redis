import { Clock, Effect, Option, Schema } from "effect";

import { Argument, parse } from "#/commands/internal/Input";
import { decode, PositiveInteger } from "#/config/Validation";
import { SubscriptionError } from "#/errors/SubscriptionError";
import type { EventError } from "#/events/Types";
import type { RedisKey } from "#/keys/RedisKey";
import type { RedisArgument } from "#/RedisArgument";
import { byteIdentity } from "#/subscriptions/Frames";
import { CacheState } from "#/tracking/cache/State";
import type { InvalidationState } from "#/tracking/Invalidation";

const defaulted = (value: number) =>
  PositiveInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));
const Policy = Schema.Struct({
  maxEntries: defaulted(1024),
  maxBytes: defaulted(8 * 1024 * 1024),
  maxInFlight: defaulted(128),
  maxKeyBytes: defaulted(64 * 1024),
  maxTtlMillis: defaulted(30_000),
});
export type CacheOptions = Partial<typeof Policy.Type>;

export interface CacheSource {
  readonly state: InvalidationState;
  readonly ready: Effect.Effect<void, EventError>;
  readonly healthy: () => boolean;
  readonly generation: () => number;
  readonly eligible: (key: Uint8Array) => boolean;
  readonly load: (key: RedisArgument) => Effect.Effect<Option.Option<Uint8Array>, EventError>;
}

const copy = (value: Option.Option<Uint8Array>) => Option.map(value, (bytes) => bytes.slice());

export const makeTrackedCache = Effect.fnUntraced(function* (
  source: CacheSource,
  options: CacheOptions = {},
) {
  const policy = yield* decode(Policy, "cache", options);
  const cache = new CacheState(policy.maxEntries, policy.maxBytes);
  let active = true;
  let inFlight = 0;
  const invalidate = (keys: ReadonlyArray<Uint8Array> | null) => cache.invalidate(keys);

  yield* Effect.acquireRelease(
    Effect.sync(() => source.state.caches.add(invalidate)),
    () =>
      Effect.sync(() => {
        active = false;
        source.state.caches.delete(invalidate);
        cache.invalidate(null);
      }),
  );

  const load = Effect.fnUntraced(function* (key: RedisArgument) {
    if (inFlight >= policy.maxInFlight)
      return yield* new SubscriptionError({ reason: "capacity", generation: source.generation() });

    return yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        inFlight++;
      }),
      () => source.load(key),
      () =>
        Effect.sync(() => {
          inFlight--;
        }),
    );
  });

  const getBytes = Effect.fnUntraced(function* (key: RedisArgument) {
    const selected = yield* parse(Argument, key);
    if (!active)
      return yield* new SubscriptionError({ reason: "closed", generation: source.generation() });

    // Large Redis keys remain valid reads without allocating a matching cache identity.
    if (selected.length > policy.maxKeyBytes) return yield* load(selected);
    const bytes =
      typeof selected === "string" ? new TextEncoder().encode(selected) : selected.slice();
    if (bytes.length > policy.maxKeyBytes) return yield* load(bytes);

    yield* source.ready;
    const now = yield* Clock.currentTimeMillis;
    const identity = byteIdentity(bytes);
    const cached = cache.get(identity, now);
    if (cached !== undefined && source.healthy()) return copy(cached.bytes);

    const revision = source.state.revision;
    const value = yield* load(bytes);
    // An invalidation arriving before a delayed GET reply must prevent stale reinsertion.
    if (
      active &&
      source.healthy() &&
      revision === source.state.revision &&
      source.eligible(bytes)
    ) {
      cache.put(identity, {
        bytes: copy(value),
        expiresAt: now + policy.maxTtlMillis,
        // Account conservatively for the UTF-16 byte identity as well as the retained value.
        cost: identity.length * 2 + (Option.isSome(value) ? value.value.length : 0),
      });
    }
    return copy(value);
  });

  return {
    getBytes,
    getKey: <A, RD, RE>(key: RedisKey<A, RD, RE>) =>
      getBytes(key.name).pipe(
        Effect.flatMap((value) =>
          Option.isNone(value)
            ? Effect.succeed(Option.none<A>())
            : key.codec.decode(value.value).pipe(Effect.map(Option.some)),
        ),
      ),
    clear: Effect.sync(() => {
      source.state.invalidate(null);
    }),
    snapshot: Effect.sync(() => ({
      entries: cache.entries.size,
      bytes: cache.bytes,
      inFlight,
      active,
    })),
  };
});

export type RedisCacheClient = Effect.Success<ReturnType<typeof makeTrackedCache>>;
