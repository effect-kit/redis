# @envoy1084/effect-redis

A runtime-neutral Redis client foundation for Effect v4. The package remains private.
The public API includes configuration decoding, binary `encodeCommand`, incremental
`makeRespDecoder`, lossless `RespValue`/`RespPairs`, `RedisArgument`/`RedisCommand`,
codec limits and typed errors. The Node-only `/node` entrypoint exports `connect`,
`layer`, `Transport` and `TransportConnection` for scoped TCP/TLS/Unix byte I/O.
The universal entrypoint also exports `makeConnection`, the `Connection` service and
its scoped Layer, connection options/snapshots, and typed admission/handshake/connection
failures. The engine executes caller-declared ordinary single-reply commands. `Redis`,
`CommandExecutor`, `Commands`, `Reply`, `RedisKey` and `PayloadCodec` add a typed
PING/GET/SET/INCR/ZSCORE slice, custom descriptors and explicit payload codecs.

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
- `pnpm check`: the complete workspace checks.

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
overflow retires the connection. This is the bounded push boundary for later
subscriptions. `snapshot` exposes safe counters without arguments or payloads.

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
contracts do not imply implemented sessions, topology routing or provider parity.

The development typecheck includes compile-only public inference and codec service
contracts. Live typed conformance covers pinned Redis/Valkey builds in RESP2/3;
full command-family and backend certification remain pending.

Development uses `#/` source imports and `#test/` imports for all test-owned modules.
Node resolves them through package imports; tsdown rewrites built module references.
The three TypeScript configs separate universal code without Node globals, native
source declaration builds, and development files/type contracts. Two Vitest configs
under test/ separate offline tests from explicitly selected live integration/e2e tests.
