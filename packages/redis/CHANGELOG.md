# @effect-kit/redis

## 0.1.2

### Patch Changes

- e48ee72: Support Effect 4.1. Effect 4.1 removed the root `Crypto` module, so importing any
  entrypoint of 0.1.1 with `effect@4.1` failed with
  `The requested module 'effect' does not provide an export named 'Crypto'`.

  Script hashing now uses the `effect/crypto` services:

  - `RedisScript.make` requires `Digest.Digest` (from `effect/crypto`) instead of `Crypto.Crypto`.
  - `cryptoLayer` from `@effect-kit/redis/node` and `@effect-kit/redis/bun` now provides
    native `Digest.Digest` and `SecureRandom.SecureRandom` instead of `Crypto.Crypto`.
    `RedisNode`/`RedisBun` Layers expose the same services.
  - Digest failures are defects, matching the `Digest` service contract.

  The `effect` peer range is now `^4.1.0`; Effect 4.0 is no longer supported because its
  `effect` package has no `effect/crypto` entrypoint.

## 0.1.1

### Patch Changes

- 25e7644: Add typed values-only batches and reusable compiled command plans. Improve native command, pipeline and transaction performance with fewer allocations, direct batch decoding, bounded reply draining and more efficient RESP buffering.

  Enable combined queue/EXEC submission for explicit standalone Redis and Valkey profiles after MULTI succeeds. Preserve typed errors, binary ownership, interruption, scoped cleanup and indexed delivery evidence. Prevent immediate reacquisition from starving queued session and blocking leases.

## 0.1.0

### Minor Changes

- 9b2a5d9: Introduce the Effect v4 Redis client with typed commands, explicit bytes and Schema
  payload codecs, scoped Node/Bun TCP/TLS/Unix connections and Upstash HTTP/SSE.

  Includes pipelines, transactions/WATCH, blocking sessions, scans, Redis Streams,
  Pub/Sub, tracking/cache, scripting/functions, Cluster and Sentinel, optional module
  families, credential providers and opt-in telemetry. Effect is the only runtime peer.

  Backend and provider compatibility is scoped to tested versions, configurations and
  operations. HTTP has explicit connection-state and encoding limits; uncertain writes
  are never replayed automatically. The package is ESM and supports Effect ^4.0.6.
