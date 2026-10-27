# @effect-kit/redis

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
