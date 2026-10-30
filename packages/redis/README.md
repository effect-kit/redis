# @effect-kit/redis

A Redis client built for **Effect v4**. Typed commands, scoped connections, Streams,
Pub/Sub, transactions and topology support share one API across Node.js, Bun and
Upstash HTTP.

The client implements RESP directly using platform sockets and Effect HTTP. Effect
is its only runtime peer dependency.

## Install

```sh
npm install @effect-kit/redis effect
pnpm add @effect-kit/redis effect
bun add @effect-kit/redis effect
yarn add @effect-kit/redis effect
```

Requires Effect `^4.0.6` and ESM. Tested native runtimes: Node.js 24.22.0 and Bun 1.4.4.

## Quick start

Provide one Layer for your runtime, then access the `Redis` service:

```ts
import { Effect, Option } from "effect";

import { Redis } from "@effect-kit/redis";
import { RedisNode } from "@effect-kit/redis/node";

const RedisLive = RedisNode.layer({ url: "redis://localhost:6379" });

const program = Effect.gen(function* () {
  const redis = yield* Redis;

  yield* redis.set("greeting", "Hello from Effect", {
    expiry: { type: "EX", value: 60 },
  });

  const greeting = yield* redis.get("greeting"); // Option<string>
  const visits = yield* redis.incr("visits"); // bigint

  return { greeting: Option.getOrElse(greeting, () => "Not found"), visits };
});

const result = await Effect.runPromise(program.pipe(Effect.provide(RedisLive)));
console.log(result);
```

The Layer owns connection startup and shutdown. Reuse it across your services.
For repeated calls from a non-Effect host, use one `ManagedRuntime` and await
`runtime.dispose()` at shutdown.

### Configuration and Bun

Load settings with Effect Config. Use `rediss://` for verified TLS.

```ts
import { Config } from "effect";

import { RedisBun } from "@effect-kit/redis/bun";
import { RedisNode } from "@effect-kit/redis/node";

const settings = Config.all({ url: Config.String("REDIS_URL") });

export const NodeRedisLive = RedisNode.layerConfig(settings);
export const BunRedisLive = RedisBun.layerConfig(settings);
```

Choose the matching runtime adapter; Redis-compatible engines share these constructors.

### Upstash HTTP

The HTTP Layer includes Effect's FetchHttpClient:

```ts
import { Config, Effect } from "effect";

import { Redis } from "@effect-kit/redis";
import { RedisUpstash } from "@effect-kit/redis/upstash";

const RedisLive = RedisUpstash.layerConfig(
  Config.all({
    url: Config.String("UPSTASH_REDIS_REST_URL"),
    token: Config.Redacted("UPSTASH_REDIS_REST_TOKEN"),
  }),
);

const program = Redis.pipe(Effect.flatMap((redis) => redis.get("greeting")));

export const runnable = program.pipe(Effect.provide(RedisLive));
```

HTTP supports commands, pipelines, transactions and text SSE. WATCH, blocking reads,
tracking and client-side topology routing require native sockets. HTTP transactions
reject ambiguous raw/custom/script replies. Binary request positions are limited;
use native Pub/Sub for binary or multiline messages.

## Typed values and commands

- `get` returns `Option<string>` with strict UTF-8 decoding; `getBytes` returns
  `Option<Uint8Array>`. Missing and empty values remain distinct.
- Integer replies use `bigint`. Decimal tokens and double-valued commands expose
  their own numeric contracts.
- `set` returns `void`, a `boolean` with a condition, or the previous bytes as an
  `Option` with `{ get: true }`. Previous bytes do not prove a condition applied.
- Keys and values accept strings or bytes. JSON encoding is always explicit.

Use Schema-backed keys for application data:

```ts
import { Effect, Schema } from "effect";

import { Redis, RedisKey } from "@effect-kit/redis";

const User = Schema.Struct({ name: Schema.String, active: Schema.Boolean });
const userKey = RedisKey.json("user:42", User);

export const saveUser = Effect.gen(function* () {
  const redis = yield* Redis;

  yield* redis.setKey(userKey, { name: "Ada", active: true });

  return yield* redis.getKey(userKey); // Option<{ name: string; active: boolean }>
});
```

`Commands` builds reusable typed operations for `redis.execute`, pipelines and
transactions. Raw commands return lossless RESP with explicit routing/execution contracts.

## Batches and compiled plans

`batch` returns a typed tuple of values. Compile fixed commands once when the same
arguments will be used repeatedly:

```ts
import { Effect } from "effect";

import { Commands, Redis } from "@effect-kit/redis";

export const readCounters = Effect.gen(function* () {
  const redis = yield* Redis;

  const values = yield* redis.batch([Commands.get("greeting"), Commands.incr("visits")]); // readonly [Option<string>, bigint]

  const plan = yield* redis.compile([Commands.get("greeting"), Commands.get("visits")]);

  const latest = yield* plan.execute();
  return { values, latest };
});
```

Native Node/Bun batches share the ordinary connection. HTTP, Cluster and Sentinel
use their existing provider batch paths and routing restrictions. Batches are ordered,
not atomic; use transactions for atomic execution. A failed slot fails a values batch
with indexed `BatchError` evidence after replies have been drained. Use `pipeline`
when individual `Result` values are preferable.

Compiled plans snapshot arguments, including bytes, and reuse native encoding after
first admission under each connection's limits. Decoder services are supplied at
execution time. Plans belong to their client's scope; keep them inside that lifetime.
Compilation accepts up to 256 commands and 16 MiB of encoded input; provider and
connection limits are still checked on every execution. Cancellation after a possible
write retires the shared native connection, including other pending requests.

## Pipelines and transactions

Heterogeneous command tuples retain each result's type:

```ts
import { Effect, Result } from "effect";

import { Commands, Redis } from "@effect-kit/redis";

export const updateVisits = Effect.gen(function* () {
  const redis = yield* Redis;

  const [saved, visits] = yield* redis.pipeline([
    Commands.set("{account:42}:name", "Ada"),
    Commands.incr("{account:42}:visits"),
  ]);

  if (Result.isFailure(visits)) return yield* visits.failure;

  const transaction = yield* redis.transaction([
    Commands.get("{account:42}:name"),
    Commands.incr("{account:42}:visits"),
  ]);

  return { saved, visits: visits.success, transaction };
});
```

Pipelines preserve order and per-command failures without atomicity. Transactions
return `Committed` with per-command Results or a WATCH `Conflict`; runtime errors
do not roll back sibling commands. Use `RedisSessions.watch(keys, use)` for WATCH
workflows. Cluster transactions require one slot, selected here by `{account:42}`.

For standalone native connections, `profile: RedisProfiles.redis()` or
`profile: RedisProfiles.valkey()` enables combined queue/EXEC submission after
MULTI succeeds. Other profiles retain sequential submission.

## Scans, Streams and Pub/Sub

Lazy cursor scans compose directly with Effect Stream:

```ts
import { Effect, Stream } from "effect";

import { Redis } from "@effect-kit/redis";

export const firstKeys = Effect.gen(function* () {
  const redis = yield* Redis;

  return yield* redis
    .scanKeys({ match: "user:*", count: 100 })
    .pipe(Stream.take(20), Stream.runCollect);
});
```

Scans can return duplicates and do not form a snapshot. `RedisStreams` provides
blocking readers, consumer-group recovery and acknowledgment after successful
processing. Handle redelivery with application idempotency.

Pub/Sub subscriptions wait for the server acknowledgment and own their lifetime:

```ts
import { Effect, Stream } from "effect";

import { Redis, RedisPubSub } from "@effect-kit/redis";
import { RedisNode } from "@effect-kit/redis/node";

const RedisLive = RedisNode.layer({ url: "redis://localhost:6379" });

const program = Effect.gen(function* () {
  const redis = yield* Redis;
  const pubsub = yield* RedisPubSub;
  const subscription = yield* pubsub.subscribe(["events"]);

  yield* redis.publish("events", "hello");

  return yield* subscription.messages.pipe(Stream.take(1), Stream.runCollect);
});

export const runnable = program.pipe(Effect.scoped, Effect.provide(RedisLive));
```

Native Pub/Sub preserves binary payloads. Disconnects, overflow and delivery gaps
are explicit. `RedisTracking` and `RedisCache` provide tracking and bounded GET caches.

## Cluster and Sentinel

Choose topology explicitly. Both Node and Bun provide these constructors:

```ts
import { RedisNode } from "@effect-kit/redis/node";

export const ClusterLive = RedisNode.layerCluster({
  url: "redis://localhost:7000",
  cluster: {
    seeds: [
      { host: "localhost", port: 7000 },
      { host: "localhost", port: 7001 },
    ],
  },
});

export const SentinelLive = RedisNode.layerSentinel({
  serviceName: "mymaster",
  sentinels: [
    { endpoint: { host: "localhost", port: 26379 } },
    { endpoint: { host: "localhost", port: 26380 } },
  ],
});
```

Cluster routes by keys and rejects unsupported cross-slot operations. Sentinel
discovers and verifies the primary. `RedisCluster`/`RedisSentinel` expose
topology-bound sessions and events; failover does not replay uncertain commands.

## Compatibility

| Backend or runtime                               | Execution path                            |
| ------------------------------------------------ | ----------------------------------------- |
| Redis, Valkey                                    | Native Node/Bun; Cluster and Sentinel     |
| Dragonfly, KeyDB, Redict, Garnet, Apache Kvrocks | Native Node/Bun; backend-specific subsets |
| Upstash                                          | Native RESP or HTTP/SSE                   |
| Aiven Valkey, Redis Cloud Free                   | Tested native configurations              |
| Deno, Cloudflare Workers                         | Upstash HTTP                              |

Commands and guarantees depend on server versions, configuration and enabled modules.
`RedisProfiles` applies deployment policies; it does not certify untested providers.
Typed modules include JSON, Search, TimeSeries, probabilistic structures and vector
sets. Upstash Search/Vector builders use their own dialects. Replication/RDB framing
and streamed RESP3 aggregates are outside the ordinary command API.

## Errors, recovery and observability

Use `Effect.catchTag` for typed failures. Server errors and batch evidence are
redacted because they can contain application data.

A timeout or disconnect after writing can leave execution uncertain. The client
never automatically replays that work, and cancellation cannot undo a mutation.

`RedisCredentials.provider(effect)` supports your identity integration;
`RedisCredentials.rotate` retires connections or aborts HTTP work.
Merge `RedisTelemetry.layer({ tracing: true })` with your runtime Layer to enable
Effect metrics and sanitized spans. Telemetry is opt-in; exporters are application-owned.

## Contributing and security

See the [repository](https://github.com/effect-kit/redis) for development and testing
commands. Report reproducible bugs through
[GitHub issues](https://github.com/effect-kit/redis/issues). For security-sensitive
reports, use GitHub's private vulnerability reporting when enabled; do not include
credentials or exploit details in public issues.

Licensed under [Apache-2.0](https://github.com/effect-kit/redis/blob/main/LICENSE).
Copyright 2026 Effect Kit Contributors.
