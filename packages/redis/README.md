# @effect-kit/redis

A Redis client built for **Effect v4**. Typed commands, scoped connections, Streams,
Pub/Sub, transactions and topology support share one API across Node.js, Bun and
Upstash HTTP.

The client implements RESP directly using platform sockets and Effect HTTP. Effect
is its only runtime peer dependency.

## Install

```sh
pnpm add @effect-kit/redis effect
```

```sh
npm install @effect-kit/redis effect
# or
bun add @effect-kit/redis effect
```

This is an ESM package for Effect `^4.0.6`. Native adapters are tested on Node.js
24.22.0 and Bun 1.4.4. The HTTP adapter also runs on Deno and Cloudflare Workers;
those runtimes do not use the native socket adapters.

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

The Layer owns connection startup and shutdown. Reuse the same Layer value across
your application's service composition. Native Layers also supply sessions,
Streams, scripts, Pub/Sub and administration services with their own scoped
connection ownership. For a host that calls Effects repeatedly,
keep a single Effect `ManagedRuntime` and await `runtime.dispose()` during shutdown.

### Configuration and Bun

Load connection settings from Effect Config. `rediss://` enables verified TLS;
`redis://` uses plaintext. Keep credentials in secret configuration.

```ts
import { Config } from "effect";

import { RedisBun } from "@effect-kit/redis/bun";
import { RedisNode } from "@effect-kit/redis/node";

const settings = Config.all({ url: Config.String("REDIS_URL") });

export const NodeRedisLive = RedisNode.layerConfig(settings);
export const BunRedisLive = RedisBun.layerConfig(settings);
```

Choose the matching runtime adapter. Redis, Valkey and other RESP engines use these
same constructors; server capabilities determine available commands.

### Upstash HTTP

The ready HTTP Layer supplies Effect's FetchHttpClient internally:

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

HTTP supports ordinary commands, pipelines, transactions and scoped text SSE.
Connection-bound features such as WATCH, blocking reads, client tracking and native
Cluster/Sentinel routing require a native adapter. HTTP transactions reject
raw/custom/script replies whose erased RESP types cannot be decoded losslessly.
Binary request positions have explicit limits; responses preserve binary bytes.
SSE is text-only, and hosted multiline payloads can be truncated: use native
Pub/Sub when payload fidelity matters.

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

`Commands` exposes reusable typed command descriptions. `redis.execute(command)`
uses the same encoders and decoders as facade methods. Raw commands return lossless
RESP values and require an explicit routing/execution contract; they do not bypass
connection ownership or backend restrictions.

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
return `Committed` with per-command Results or `Conflict` for an aborted WATCH.
Redis does not roll back sibling commands after a runtime error. Use
`RedisSessions.watch(keys, use)` for a connection-bound read/check/transaction
workflow. Cluster transactions require all keys in one slot; matching hash tags
such as `{account:42}` select that slot.

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

Scan COUNT is a hint; results can contain duplicates and do not form a snapshot.
`RedisStreams` adds scoped blocking readers, consumer-group pending/claim recovery
and processing with acknowledgment after success. Processing can be redelivered;
application side effects need an idempotency policy.

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

Native Pub/Sub preserves binary payloads. Disconnects and overflow are visible;
optional resubscription reports delivery gaps and cannot recover missed messages.
Managed tracking and bounded GET-byte caches are available separately through
`RedisTracking` and `RedisCache`.

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

Cluster routes by binary keys, bounds redirects and rejects unsupported cross-slot
operations. Sentinel verifies the primary role before admission. Specialized
`RedisCluster`/`RedisSentinel` services expose topology-owned sessions and events.
Failover does not add strong consistency or replay uncertain commands.

## Compatibility

| Backend or runtime                               | Execution path                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| Redis, Valkey                                    | Native Node/Bun, including Cluster and Sentinel fixtures                   |
| Dragonfly, KeyDB, Redict, Garnet, Apache Kvrocks | Native Node/Bun with backend-specific command subsets                      |
| Upstash                                          | Native RESP or HTTP/SSE; provider Search/Vector/ACL have separate builders |
| Aiven Valkey, Redis Cloud Free                   | Tested isolated hosted configurations using native adapters                |
| Deno, Cloudflare Workers                         | Upstash HTTP; no native TCP claim                                          |

Compatibility is specific to server versions, configuration, protocol, runtime and
executed operations. Redis command acceptance does not establish semantic parity.
Alternative engines can reject options or behave differently; the client preserves
those outcomes. `RedisProfiles` adds reviewed deployment policies, including a
Garnet guard for `ZSCAN NOSCORES`. A profile alone does not certify a hosted service.
Other cloud-provider configurations are not certified.

Typed module families cover JSON, Search, TimeSeries, Bloom/Cuckoo/CMS/TopK/t-digest
and vector sets when enabled on the server. Module versions and dialects matter.
Upstash `SEARCH.*`/`VECTOR.*` are distinct from Redis `FT.*`/`V*`.
Advanced replication/RDB framing and streamed RESP3 aggregates are outside the
ordinary request/reply contract.

## Errors, recovery and observability

Expected failures use tagged Effect errors: configuration, admission, transport,
handshake, server, reply, payload and batch failures remain distinguishable. Server
errors and batch evidence are redacted because they can contain application data.
Use `Effect.catchTag` for the failure your application can actually recover from.

A disconnect or timeout after a write can have an unknown execution outcome.
The client never automatically replays that command, transaction or script. New
work can establish a fresh connection. Application retry must account for remote
side effects; cancellation cannot undo a write.

`RedisCredentials.provider(effect)` accepts your existing identity integration
without adding cloud SDKs. Refresh is bounded; `RedisCredentials.rotate` explicitly
retires owned connections or aborts HTTP work. Credentials use `Redacted`.

Merge `RedisTelemetry.layer({ tracing: true })` with your runtime Layer to opt into
Effect metrics and sanitized spans. Instrumentation is disabled by default and
uses bounded operation/outcome labels without keys, values or endpoints. Exporters
remain application-owned.

## Contributing and security

See the [repository](https://github.com/effect-kit/redis) for development and testing
commands. Report reproducible bugs through
[GitHub issues](https://github.com/effect-kit/redis/issues). For security-sensitive
reports, use GitHub's private vulnerability reporting when enabled; do not include
credentials or exploit details in public issues.

Licensed under [Apache-2.0](https://github.com/effect-kit/redis/blob/main/LICENSE).
Copyright 2026 Effect Kit Contributors.
