# @effect-kit/redis

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
