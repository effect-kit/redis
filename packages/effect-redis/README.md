# @envoy1084/effect-redis

A runtime-neutral Redis client foundation for Effect v4. The package remains private.
The public API includes configuration decoding, binary `encodeCommand`, incremental
`makeRespDecoder`, lossless `RespValue`/`RespPairs`, `RedisArgument`/`RedisCommand`,
codec limits and typed errors. The Node-only `/node` entrypoint exports `connect`,
`layer`, `Transport` and `TransportConnection` for scoped TCP/TLS/Unix byte I/O,
plus an optional `cryptoLayer` for Effect Crypto.
The universal entrypoint also exports `makeConnection`, the `Connection` service and
its scoped Layer, connection options/snapshots, and typed admission/handshake/connection
failures. The engine executes caller-declared ordinary single-reply commands. `Redis`,
`CommandExecutor`, `Commands`, `Reply`, `RedisKey` and `PayloadCodec` add typed
ordinary commands across strings, hashes, lists, sets, keys/TTL, sorted sets, bitmaps,
HyperLogLog, geo and arrays, plus custom descriptors and explicit payload codecs.
The data families cover 187 reviewed ordinary commands; available commands/options depend on the
actual server. Native sessions add pipelines, transactions, WATCH, connection controls
and blocking leases. Scan commands, Redis Streams and scoped consumer workflows have
unit, controlled, primary Redis/Valkey and packed-consumer coverage. Scoped Pub/Sub,
client tracking and bounded GET-byte caches extend event delivery. Lua/functions,
administration, native hash imports/backups and diagnostic modes are implemented.
Native Redis/Valkey Cluster adds slot routing, topology recovery and node-bound workflows.
Native Redis/Valkey Sentinel adds verified discovery, generation-bound sessions and
future-work failover.
Typed Bloom, Cuckoo, Count-Min Sketch, TopK and t-digest builders require the
corresponding server module; availability and numeric reply contracts remain explicit.
Typed JSON builders preserve JSONPath multiplicity, legacy-path results and serialized
bytes. `jsonSetWith`/`jsonGetWith` explicitly select a `PayloadCodec`; expanded
RESP3 formats have separate methods and retain actual provider availability.
Vector-set builders distinguish members, scored/attribute matches, graph links and
raw quantized embeddings. `encodeFloat32` uses an explicit byte order (little endian
by default); match the server CPU for Redis's native FP32 layout. Repeat nondefault
quantization and connection-count settings on subsequent `vadd` operations.

The codecs return Effect Result; use Effect.fromResult to compose them into Effects.
Feed bounded byte chunks, drain decoder.next() between feeds, and drain after end()
to detect truncated input. Detailed architecture notes and progress reports stay in
ignored local research. [Tests](test/README.md) own executable assertions, pinned
fixtures and runners; fixture definitions alone are not conformance evidence.

Effect `^4.0.6` is the only runtime peer dependency. Universal exports have no Node/Bun imports.
Builds use tsdown/Klarity, TypeScript 7 declarations and Publint. Tests, fixtures and
runners stay outside the package artifact.

Run from the workspace root:

- `pnpm --filter @envoy1084/effect-redis test`: offline unit and controlled integration tests.
- `pnpm --filter @envoy1084/effect-redis test:unit`: focused unit tests only.
- `pnpm --filter @envoy1084/effect-redis typecheck`: source and test/type-contract configurations.
- `pnpm --filter @envoy1084/effect-redis lint`: source and all test-owned modules.
- `pnpm --filter @envoy1084/effect-redis build`: unbundled ESM/declarations plus Publint.
- `pnpm test:protocol:fuzz`: built-artifact fuzz/large-input corpus under an external watchdog.
- `pnpm fixtures:check`: validate pinned backend fixtures before live acquisition.
- `pnpm check`: offline workspace checks.
- `pnpm verify`: offline checks, fixture validation, protocol corpus and all live suites.

Default tests require no Redis process, credentials or network access. `pnpm test:live`
(`test:node` alias) uses scoped Testcontainers fixtures for twelve versions across
Redis, Valkey, Dragonfly, KeyDB, Redict, Garnet and Kvrocks. Prepare digest-pinned
images explicitly with `pnpm fixtures:pull`; tests require a local Docker-compatible
daemon and OpenSSL. `--engine valkey` selects an engine. Explicit `--mode binary`
owns a supplied Redis/Valkey executable; `--mode endpoint` reads
`EFFECT_REDIS_TEST_URL` and runs read-only PING/ECHO, with connection-only AUTH when
needed. Optional `EFFECT_REDIS_TEST_CA` names a custom CA file. See the workspace
README for commands and manual PR CI triggers. Full engine/provider certification
remains pending.

Licensed under Apache-2.0. Package archives include the license and built artifacts;
`prepack` rebuilds them, and pnpm replaces catalog references with compatible ranges.

Node transport accepts a validated `RedisConfig` inside an Effect scope. `read`
returns owned nonempty bytes or `undefined` for clean EOF; `write` applies bounded
backpressure; `close` is idempotent and wakes pending operations. Only one reader and
writer may own a connection. Canceling an active write retires that socket because
a prefix may have been sent. Local write completion does not prove server execution.

TLS verifies trust and identity by default and supports explicit SNI, custom CAs and
client certificates. Acquisition includes the TLS handshake and connect deadline;
The connection engine completes AUTH, HELLO, optional naming and database selection
before admission. Automatic protocol fallback requires a reviewed unsupported HELLO/
protocol response. Authentication, ACL and malformed responses remain failures.

```ts
import { Effect } from "effect";

import { decodeRedisConfig, makeConnection } from "@envoy1084/effect-redis";
import { layer as NodeTransport } from "@envoy1084/effect-redis/node";

const ping = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });
    const connection = yield* makeConnection(config);
    return yield* connection.executeOrdinary(["PING"]);
  }),
).pipe(Effect.provide(NodeTransport));
```

`executeOrdinary` returns lossless RESP values, including raw server errors. The typed executor maps server errors to
redacted `ServerError`; reply/payload decoding failures have separate tagged errors. Known stateful/blocking operations require
session APIs; custom commands must obey the caller-declared single-reply contract.

Admission bounds queued/in-flight counts and encoded bytes. Full queues fail with
`AdmissionError`; accepted work waits fairly within its command deadline. Cancellation
before write removes work. Cancellation after possible write retires that generation;
sibling failures retain `unsent` or `possibly-written` evidence. Neither queued old
work nor uncertain requests are replayed. New work may acquire a fresh generation.
A local write keeps the original deadline even if its reply arrives before the write
callback; a stalled callback cannot retain capacity indefinitely.

Options default to three acquisition attempts, 100 ms initial exponential backoff
(capped at 60 seconds), a 5-second graceful drain, 64 push messages and a 1 MiB push wire-byte budget. `credentials` accepts an Effect source captured at acquisition
and rerun for each physical connection; choose it or fixed config credentials. Supply
redacted credentials and map expected source failures to `HandshakeError`.

`close` stops admission and drains with a deadline; `abort` retires immediately and
awaits scoped cleanup. Cleanup defects propagate and prevent replacement acquisition.
`takePush` permits one waiting consumer, preserves attributes and tags generations;
overflow retires the connection. Managed event lifetimes use `RedisPubSub` and
`RedisTracking`. `snapshot` exposes safe counters without arguments or payloads.

The typed service composes over the same connection:

```ts
import { Effect, Layer, Schema } from "effect";

import {
  CommandExecutor,
  Connection,
  Redis,
  RedisKey,
  decodeRedisConfig,
} from "@envoy1084/effect-redis";
import { layer as NodeTransport } from "@envoy1084/effect-redis/node";

const program = Effect.gen(function* () {
  const redis = yield* Redis;
  const user = RedisKey.json("user:1", Schema.Struct({ name: Schema.String }));
  yield* redis.setKey(user, { name: "Ada" });
  const value = yield* redis.getKey(user);
  const created = yield* redis.set("once", "value", { condition: "NX" });
  const count = yield* redis.incr("count");
  return { value, created, count };
});

const runnable = Effect.gen(function* () {
  const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });
  const live = Redis.layer.pipe(
    Layer.provide(CommandExecutor.layer),
    Layer.provide(Connection.layer(config)),
    Layer.provide(NodeTransport),
  );
  return yield* program.pipe(Effect.provide(live));
});
```

`get` returns strict UTF-8 `Option<string>`; `getBytes` returns `Option<Uint8Array>`.
Text preserves a leading BOM and rejects malformed UTF-8. `incr` returns bigint.
`zscore` returns `Option<number>` in the server's IEEE double domain;
`zscoreToken` preserves the decimal token. No raw operation auto-serializes JSON.

SET returns void normally, boolean with a condition, or previous bytes as Option
with `{ get: true }`. Previous values do not prove a conditional write applied.
`expiry: { type: "EX" | "PX" | "EXAT" | "PXAT", value }` uses whole positive units;
`{ type: "KEEPTTL" }` retains expiry. `expiryAfter(Duration)` validates exact whole
milliseconds. Conditions/options still depend on actual server versions: for example,
Valkey 9.1.2 supports IFEQ, while IFNE/digest conditions are absent there.

`Commands` exposes the same operations as lazy command descriptions. Use
`redis.execute(Commands.get("key"))`, or prepare explicitly then executePrepared.
Preparation requires encoding services; decoding services are needed at execution.
Typed-key writes intentionally exclude GET; use getKey for decoded payload reads.
Prepared binary tokens are borrowed until admission; do not mutate them during use.

`redis.raw(tokens, { execution: "ordinary", routing: { _tag: "Keyless" } })` preserves
lossless RESP, including errors. Keyed custom calls declare key argument indexes and
access roles. `defineCommand` additionally requires a reply decoder and provenance.
The standalone executor rejects nonordinary modes and explicit-node routing. These
contracts do not bypass session ownership, topology routing or provider capabilities.

The development typecheck includes compile-only public inference and codec service
contracts. Live ordinary-family conformance covers the seven pinned Redis/Valkey
builds in RESP2/3, including older-server errors. Other engines have transport/state
smoke tests; full command, runtime and backend certification remain pending.

Development uses `#/` source imports and `#test/` imports for all test-owned modules.
Node resolves them through package imports; tsdown rewrites built module references.
The three TypeScript configs separate universal code without Node globals, native
source declaration builds, and development files/type contracts. Two Vitest configs
under test/ separate offline tests from explicitly selected live integration/e2e tests.

New collection APIs preserve bytes and ordered pairs. Use named result variants such
as lpopCount, zrangeWithScores, lcsMatches and geosearchWith for replies whose shape
changes with options. Numeric string/hash/array aggregates retain decimal wire tokens;
TTL results keep -1/-2 sentinels and array cursors use exact unsigned bigint values.
SORT BY/GET patterns carry unresolved routing metadata: standalone support does not
imply Cluster execution. Commands/options are sent explicitly; older servers may
reject them with typed server errors, and no semantic emulation or replay occurs.

Positional replies such as MGET, HMGET and BITFIELD must match the prepared request
length. Reply shape errors mean the server has already replied; they do not cause
replay. Binary key/member/value arguments remain bytes throughout encoding/decoding.

Native `RedisSessions.layer(config, options)` provides `RedisSessions` and `BatchExecutor`.
Add it to the existing native composition with `Layer.provideMerge`; ordinary-only
programs keep their current Layer. `redis.pipeline` and `redis.transaction` require
`BatchExecutor`, while a leased session has its batch executor captured already.

```ts
import { RedisSessions } from "@envoy1084/effect-redis";

const live = Redis.layer.pipe(
  Layer.provide(CommandExecutor.layer),
  Layer.provide(Connection.layer(config)),
  Layer.provideMerge(RedisSessions.layer(config)),
  Layer.provide(NodeTransport),
);
```

Pipelines accept readonly heterogeneous `Commands` tuples and return per-slot Effect
Results. Transactions return `{ _tag: "Committed", results }` or `{ _tag: "Conflict" }`;
queue rejection is a separate `TransactionError`. Runtime EXEC errors remain individual
results. Neither mechanism rolls back successful mutations or replays uncertain work.
`BatchError.outcomes` is redacted and retains indexed completed, received, unsent and
unknown slots. Explicit `Redacted.value` inspection can reveal application values.
Interruption and defects remain in the Cause alongside available batch evidence.

Use `sessions.watch(keys, use)` or `sessions.withSession(use)` for a generation-bound
client. Use it sequentially: concurrent calls and nested transaction attempts fail
explicitly. Scope exit cleans known WATCH/MULTI state or retires the connection;
a retained session object fails after its scope ends. Advanced/exclusive raw calls
must declare single-reply semantics and retire their lease on release; their raw
contract can set `replyTimeoutMillis`, including explicit `"forever"`. Known mode
switches still require their reviewed APIs.

Blocking operations are available on `RedisSessions` and leased clients, with builders
under `Commands`. For example, `sessions.blpop(["jobs"], { blockFor: Duration.seconds(30) })`
returns an optional binary key/value pair. `blockFor: "forever"` is explicit. The optional
`timeout` sets an independent client deadline; otherwise finite waits allow one extra
second and forever waits remain scoped until completion/cancellation. Writes always
retain the configured bounded write deadline. Server timeout is an absent value;
a lost reply after a destructive pop can mean the element was already consumed.

`session.waitForReplicas` and `session.waitForAof` stay with the preceding writes on
that session. They return actual acknowledgment counts, including when a server wait
expires. Both take the same explicit duration options; server waits use whole milliseconds.
Local AOF acknowledgment counts are zero or one. These APIs do not promise strong
consistency or protection from every failover/storage failure.

`session.caching(mode, command)` keeps CLIENT CACHING adjacent to its command; the caller
must configure a compatible tracking mode. `RedisTracking` owns managed tracking and
invalidation lifetimes. `withoutReplies(commands)` and `skipReply(command)` restore
REPLY ON with a fenced compound write and intentionally discard individual results/errors.
Failure of that fence can leave mutations uncertain. RESET and QUIT retire the lease;
Valkey capability/import-source flags are isolated to the owning scope.

Session options default to four session sockets, two blocking sockets, 128 queued
acquisitions, a five-second lease-acquisition deadline, a one-second cleanup deadline
and 256 commands per batch. Both socket lanes are lazy and separately bounded; the
ordinary Connection remains separately owned. Existing wire count/byte limits also
apply. `connection.credentials` captures an Effect credential source for each newly
opened physical lease connection, or configuration supplies fixed credentials.

Scan commands return typed pages with opaque decimal cursors. `scanKeys`, `scanHash`,
`scanHashFields`, `scanSet`, `scanSortedSet` and `scanSortedMembers` return lazy Effect
Streams. Empty nonterminal pages and duplicate values are preserved; COUNT is a hint,
and scans provide no snapshot/deduplication guarantee. `scanArray` uses ARSCAN's
ordered index ranges in either direction, with a default LIMIT of 128. UINT64_MAX is
reserved for the array insertion cursor and cannot be used as an ARSCAN bound.

Redis Streams commands preserve exact IDs and ordered binary field/value pairs.
Named variants include xaddIfExists, xclaimIds, xautoclaimIds, xpendingEntries,
xinfoStreamFull and xreadgroupClaim. Nonblocking reads are ordinary Effects; blocking
reads use `RedisSessions.xreadBlocking`/`xreadgroupBlocking` or a leased client.
CLAIM readers retain their additional delivery metadata. Older claim responses can
contain unavailable entries without IDs: Option.none preserves this evidence.
XAUTOCLAIM's deleted-ID list is also optional because older replies omit it.

`RedisStreams.layer` captures Redis and RedisSessions; compose it over the existing
native Layer. `makeRedisStreams(redis, sessions)` supports explicit composition.

```ts
import { Stream } from "effect";

import { RedisStreams } from "@envoy1084/effect-redis";

const streamsLive = RedisStreams.layer.pipe(Layer.provideMerge(live));

const streamProgram = Effect.gen(function* () {
  const streams = yield* RedisStreams;

  return yield* streams.read([["events", "$"]]).pipe(Stream.take(10), Stream.runCollect);
}).pipe(Effect.provide(streamsLive));
```

`read` resolves $ once and advances concrete per-stream IDs. `readGroup` requests new
entries; `pending` reads this consumer's history; `claim` emits complete recovery pages,
including empty continuation pages and deletion evidence. Readers hold dedicated
blocking capacity, use a one-entry handoff queue, and default to COUNT 64 and a
five-second server wait. A decoded server batch can also remain in memory. Explicit
count/cumulative-size options retain server availability rules; MAXSIZE can still
return one oversized entry, independently of the client protocol byte limits.
Connection failure terminates the reader; resumption/recovery is explicit.

`process(group, messages, handle, options)` acknowledges after the application Effect
succeeds. `consume(group, consumer, keys, handle, options, readOptions)` first finishes
this consumer's pending processing, then processes new deliveries. Defaults are one
worker and one attempt; concurrency is bounded at 256 and attempts at 100. Optional
onFailure decisions are Retry with an Effect Duration, LeavePending with a redacted
visible outcome, or explicit Acknowledge. Tombstones require explicit policy; defects,
interruption and failed acknowledgments never retry the application automatically.

A dead-letter Effect must succeed before an Acknowledge decision. Its write and XACK
have no implicit atomicity. Processing may succeed before a crash prevents acknowledgment,
so applications must account for redelivery and external-effect idempotency.

`StreamPayload.field(name, PayloadCodec.json(schema))` selects an explicit single-field
envelope. `redis.xaddPayload` retains encoding services; payload.decode/decodeGroup
retain decoding services. Missing, duplicate, malformed and tombstoned payload fields
fail with PayloadError. Raw stream entries remain available and no raw value is
implicitly JSON-encoded or acknowledged because decoding failed.

`RedisPubSub.layer(config, options)` owns a dedicated scoped event connection;
`makeRedisPubSub` supports explicit construction. Acquisition waits for server
acknowledgments. Duplicate local listeners share server subscriptions; Pub/Sub is
server-wide across databases. Publication counts report recipients, not processing.

```ts
import { RedisPubSub } from "@envoy1084/effect-redis";

const subscriptionsLive = RedisPubSub.layer(config).pipe(
  Layer.provideMerge(live),
  Layer.provide(NodeTransport),
);

const subscriptionProgram = Effect.gen(function* () {
  const pubsub = yield* RedisPubSub;
  const redis = yield* Redis;
  const subscription = yield* pubsub.subscribe(["orders.created"]);

  yield* redis.publish("orders.created", "order-123");
  return yield* subscription.messages.pipe(Stream.take(1), Stream.runCollect);
}).pipe(Effect.scoped, Effect.provide(subscriptionsLive));
```

`psubscribe` and `ssubscribe` select pattern/sharded modes. Messages preserve binary
payloads, channel/pattern identities, RESP attributes and connection generations.
Each local listener owns its buffers. `close()` releases its child Scope immediately;
the caller's Scope also owns cleanup. Unknown pushes have a bounded diagnostic Stream.

Default disconnect fails. `{ recovery: "resubscribe" }` enables bounded recovery;
consume `events` to observe DeliveryGap and subsequent Ready events. `messages` fails
on a gap. These are single-consumer views of one mailbox. Pub/Sub has no durable
replay. Sharded support depends on the server. Standalone subscriptions stay node-bound;
use the Cluster service below for explicit slot-owner selection and topology lifetimes.

Defaults bound active/retiring listeners to 128, unique interests to 1,024/1 MiB,
mailboxes to 64 events/1 MiB and shared retained events to 16 MiB. Lifecycle events
also consume count capacity. Overflow fails visibly; a slow listener never suspends
the reader. Control admission defaults to 128 owners; whole-operation deadlines use
the Redis config. Heartbeats run every 30 seconds. Recovery defaults to three attempts
with 100 ms spacing, and never retries publications or authentication rejection.

`RedisTracking.layer(config, options)` owns tracked execution and invalidation state.
It supports default, optin, optout and broadcast-prefix modes. RESP3 uses inline
invalidations by default; RESP2 and `delivery: "redirect"` own a separate receiver.
Managed tracking owns its redirect ID; `session.tracking`/`trackingInfo` expose
exclusive controls, including custom redirection. `tracking.caching(mode, command)`
pairs the next-command flag with its command. Typed GET helpers opt in automatically.

`tracking.events` exposes TrackingReady/TrackingGap/Invalidate; `invalidations` filters
readiness and fails on gaps. Both views share one observer mailbox. Critical cache
eviction happens before observers, so observer overflow cannot prevent invalidation.
Connection loss clears the cohort. Calls fail until explicit `tracking.restart`
re-establishes it; no mutation is replayed. Unknown pushes remain separately observable.

```ts
import { RedisCache, RedisTracking } from "@envoy1084/effect-redis";

const cacheLive = RedisCache.layer({ maxEntries: 1024 }).pipe(
  Layer.provideMerge(RedisTracking.layer(config, { tracking: { mode: "optin" } })),
  Layer.provide(NodeTransport),
);

const cachedProgram = RedisCache.pipe(
  Effect.flatMap((cache) =>
    cache.getKey(RedisKey.json("user:1", Schema.Struct({ name: Schema.String }))),
  ),
  Effect.provide(cacheLive),
);
```

Provide cache Layers once for the application lifetime. Cache helpers store GET bytes;
each typed codec decodes anew with its own services. Backend/database identity, binary
keys, missing values and codec results remain separate. Defaults are 1,024 entries,
8 MiB of values/key identities, 128 in-flight loads, 64 KiB eligible keys and a 30-second
maximum local TTL. Oversized keys/values bypass storage. Returned bytes are owned;
eviction uses LRU. Broadcast caches store only keys under tracked prefixes.

Invalidation before a delayed GET reply prevents insertion. Declared local writes,
flushes, connection gaps and restart invalidate affected state. Invalidation delivery
is asynchronous; these helpers do not create strong consistency or exactly-once delivery.

Lua and function calls require explicit keys, arguments and a reply decoder:
`redis.evalScript(source, { keys, args }, Reply.integer)` and
`redis.fcall(name, { keys, args }, Reply.blob)`. Read-only variants are separately
named. Builders under `Commands` retain decoder requirements and key indexes.
SCRIPT/FUNCTION lifecycle operations are explicit; function libraries are installed
by the caller.

```ts
import { Effect } from "effect";

import {
  RedisScript,
  Reply,
  decodeRedisConfig,
  makeRedisScripts,
  makeRedisSessions,
} from "@envoy1084/effect-redis";
import { cryptoLayer as NodeCrypto, layer as NodeTransport } from "@envoy1084/effect-redis/node";

const scriptProgram = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });
    const sessions = yield* makeRedisSessions(config);
    const scripts = yield* makeRedisScripts(sessions);
    const counter = yield* RedisScript.make({
      source: "return redis.call('INCR', KEYS[1])",
      decode: Reply.integer,
    });

    return yield* scripts.execute(counter, { keys: ["counter"] });
  }),
).pipe(Effect.provide(NodeTransport), Effect.provide(NodeCrypto));
```

`RedisScripts.layer()` captures `RedisSessions`. A canonical server NOSCRIPT rejection
permits one load and one retry on the same physical connection. Load receipts default
to connection scope. `{ loadScope: "server" }` shares pending loads only when the caller
can guarantee that every lease targets the same physical server. Managed Lua
source must reserve Redis's canonical NOSCRIPT errors for server cache rejection.
Other errors, decoder failures and uncertain writes propagate. Shared load failure/cancellation reaches its waiters. Defaults bound concurrent loads to 64 and
additional binary argument snapshots to 16 MiB per active lease. Immutable strings are
borrowed; keep queued input unchanged. Each wire operation uses the native deadline.
Explicitly preload scripts before batches; pipelines/transactions never replay siblings.

`RedisAdmin.layer` captures `RedisSessions`; `makeRedisAdmin(sessions)` provides the
same explicit composition. ACL/configuration, INFO, memory, command introspection,
client controls, persistence, backups and MIGRATE use that configured backend.
Each operation leases a connection. `admin.withSession(use)` groups related controls;
exclusive operations retire their lease on release. Secret-bearing configuration,
ACL rules and diagnostic logs use `Redacted`. INFO preserves strings, duplicate fields
and unknown sections; open-ended structured reports retain lossless fields.
MIGRATE errors can follow partial transfers. No rollback or automatic retry is implied.

`session.authenticate`, `selectDatabase` and `hello()` expose reviewed connection
controls. AUTH/SELECT changes retire their physical lease. `hello()` inspects the
current protocol; initial negotiation belongs to configuration. Redis 8.10 HIMPORT
uses `session.himportPrepare/Set/Discard/DiscardAll`: positional fieldsets belong to
that client and HIMPORT SET replaces the hash. BACKUP controls expose the server's
snapshot/abort/seal/cleanup lifecycle, with exact times and redacted file paths.

`RedisMonitor.layer(config)` / `makeRedisMonitor(config)` acquires a dedicated scoped
connection. `events` is a single-consumer Stream of Command/Unknown records. Timestamps
remain decimal text; database IDs are bigint; client/command/raw content is redacted.
Defaults allow 64 queued events, 1 MiB retained bytes and 64 KiB diagnostic lines, bounded
by the decoder buffer. Raw bytes plus text are charged at three times wire size.
`close` ends the stream. Overflow, framing errors and disconnect fail it; recovery is
explicit. Ordinary connections keep their existing header limits.

`RedisShutdown.layer(config)` / `makeRedisShutdown(config)` owns each control socket.
`shutdown({ save: "NOSAVE" })` reports ConnectionClosed with `execution: "unknown"`
after EOF. `abort()` requires a real OK reply. One shutdown and one abort may run
concurrently; additional same-kind calls fail unsent. Cleanup defects prevent implicit
replacement. QUIT/RESET/reply suppression retain their reviewed session APIs.

Availability remains version/configuration-specific. ACL DIGEST's 9.2 descriptor has
no positive claim on pinned Valkey 9.1; topology/module scenarios keep their own gates.
Private replication/RDB, protected debug and interactive Lua debugger protocols are
excluded. Four BLESS catalog records describe Redis 8.12 without a verified
reply contract in the pinned baselines; they have no invented typed wrappers.

## Cluster

`RedisCluster.layer(config, options)` provides `Redis`, `CommandExecutor`, `BatchExecutor`
and `RedisCluster`. Existing typed commands keep their result/error/codec contracts.
The factory captures the same services without requiring an application Layer:

```ts
import { Effect } from "effect";

import { decodeRedisConfig, makeRedisCluster } from "@envoy1084/effect-redis";
import { layer as NodeTransport } from "@envoy1084/effect-redis/node";

const clusterProgram = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost", port: 7000 } });
    const cluster = yield* makeRedisCluster(config, {
      seeds: [{ host: "localhost", port: 7001 }],
    });

    yield* cluster.redis.set("user:{42}:name", "Ada");
    return yield* cluster.redis.get("user:{42}:name");
  }),
).pipe(Effect.provide(NodeTransport));
```

Default execution targets primaries. `readPreference: "replica-preferred"` explicitly
permits stale replica reads for eligible commands. SHARDS/SLOTS discovery and periodic
refresh are bounded; ACL errors do not authorize legacy fallback. `addressMap` translates
announced host/port pairs and can set `serverName` independently of the dial address.
Redis clients use DB0. Configured Valkey multi-DB needs `databaseCapability:
"valkey-multi-db"`; its server must enable the selected database with `cluster-databases`.

`cluster.pipeline`/`transaction` require a single slot. `withSession({ key }, use)` pins
that slot/node; `{ node: id }` explicitly selects a node. Cross-slot operations fail
before application writes. A lease never migrates with an active WATCH/transaction.
MOVED/ASK rejection recovery is bounded; uncertain wire outcomes and EXEC never replay.
Native blocking helpers retain their explicit reply deadlines, including scoped forever.

`node(id)` and `admin(id)` expose explicit node operations. `onPrimaries(command)` is a
lazy sequential Stream of per-node Results. `scanKeys` traverses distinct primaries,
preserves duplicates and fails if the observed topology changes; it is not a snapshot.
Valkey's `clusterScan`/`scanCluster` retain opaque tagged cursors and actual availability.
Dynamic SORT patterns require an explicit node; COPY DB/MOVE/SWAPDB remain rejected.

`scripts({ key })` loads missing scripts on their actual node and lease, including
ASK/NOSCRIPT adjacency. Application decoders run after recovery. Managed Lua must not
forge reserved cache/routing rejections. `streams(target)`, `pubsub(target)` and
`tracking(target)` bind their dedicated lifetimes explicitly. Topology changes/redirects
close old cohorts and clear their caches; reacquire on the new owner. Node reconnect
can expose DeliveryGap/Ready, without recovering missed publications.

Defaults: 64 node pools including retained seeds/retiring resources, four session and
two blocking sockets per node, 1,024 admitted commands/16 MiB retained intent, eight
redirects, 64 event cohorts and 30-second ordinary deadlines/refresh intervals. Event
cohorts own additional dedicated sockets. All resources belong to Scope. Full hosted
provider and secondary-engine Cluster certification remains separate.

## Sentinel

`RedisSentinel.layer(config, options)` provides `RedisSentinel`, `Redis`,
`CommandExecutor` and `BatchExecutor`. The scoped factory captures the same services:

```ts
import { Effect } from "effect";

import { decodeSentinelConfig, makeRedisSentinel } from "@envoy1084/effect-redis";
import { layer as NodeTransport } from "@envoy1084/effect-redis/node";

const sentinelProgram = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* decodeSentinelConfig({
      serviceName: "cache",
      sentinels: [
        { endpoint: { host: "localhost", port: 26379 } },
        { endpoint: { host: "localhost", port: 26380 } },
      ],
      data: { database: 0 },
    });
    const client = yield* makeRedisSentinel(config);

    yield* client.redis.set("user:42:name", "Ada");
    return yield* client.redis.get("user:42:name");
  }),
).pipe(Effect.provide(NodeTransport));
```

Sentinel endpoints default to port 26379 and DB0. The data template selects the
application database and protocol; discovery supplies its address. Each physical data
connection re-resolves Sentinel and verifies ROLE after authentication/negotiation.
`sentinelConnection.credentials` and `connection.credentials` capture independent
Effect credential sources; fixed credentials instead belong to their respective
configuration. Each source is reacquired in its physical connection's Scope.

Discovery TLS belongs to each Sentinel endpoint. `dataTls` accepts validated TLS
options with redacted CA/certificate/key material and explicit `rejectUnauthorized`.
`addressMap(address, plane)` translates advertised addresses separately for control
and data connections and can override TLS `serverName` independently of the dial host.

Primary reads are the default. `readPreference: "replica-preferred"` explicitly allows
stale reads for eligible ordinary commands; sessions, writes, scripts, scans and stream
consumers stay on the primary. Pipelines and transactions retain standalone multi-key
semantics. `withSession`, `withBlockingSession`, `watch`, `scripts()`, `streams` and
`admin` reuse native ownership and typed results. A lease never moves after its callback
starts. Bounded acquisition may follow a newly discovered primary before that point.

Future work can discover promotion after failure; an operation that may have executed
is never replayed. Unknown mutation/EXEC outcomes retain their native indexed evidence.
Periodic refresh and per-connection queries drive discovery; Sentinel notifications
are not required. ROLE cannot fence an isolated old primary, and asynchronous replication
can lose acknowledged writes during failover. This client does not add strong consistency.

`scanKeys` and the other lazy scans remain bound to their starting primary/generation
and fail on a change. `pubsub()` and `tracking()` create scoped cohorts; old cohorts close
and caches clear before replacement routing is published. Reacquire them explicitly.
`sentinel(index).execute(Commands.sentinelMasters())` targets a configured control
endpoint. The typed Sentinel family preserves version-specific aliases/options and
actual server errors. Control mutations are explicit and never retried automatically.

Defaults bound discovery to 16 Sentinel endpoints and 16 data-node pools, 1,024 logical
operations, 64 event cohorts, three discovery attempts, five-second discovery and
500 ms candidate deadlines, plus 30-second ordinary operation/refresh intervals.
Native session/blocking limits apply per data pool; event cohorts own additional
dedicated sockets. `learnSentinels: true` opts into bounded peer discovery.
