# @envoy1084/effect-redis

A runtime-neutral Redis client foundation for Effect v4. The package remains private.
The public API includes configuration decoding, binary `encodeCommand`, incremental
`makeRespDecoder`, lossless `RespValue`/`RespPairs`, `RedisArgument`/`RedisCommand`,
codec limits and typed errors. The Node-only `/node` entrypoint exports `connect`,
`layer`, `Transport` and `TransportConnection` for scoped TCP/TLS/Unix byte I/O.
The ordinary Redis command connection engine arrives in phase 04.

The codecs return Effect Result; use Effect.fromResult to compose them into Effects.
Feed bounded byte chunks, drain decoder.next() between feeds, and drain after end()
to detect truncated input. Detailed architecture notes and progress reports stay in
ignored local research. [Release specifications](../../spec/README.md) track planned
coverage; their presence is not conformance evidence.

Effect `^4.0.6` is the only runtime peer dependency. Universal exports have no Node/Bun imports.
Builds use tsdown/Klarity, TypeScript 7 declarations and Publint. Tests, tools and
specifications stay outside the package artifact.

Run from the workspace root:

- `pnpm --filter @envoy1084/effect-redis test` (or `test:unit`): offline Vitest/Effect tests.
- `pnpm --filter @envoy1084/effect-redis typecheck`: source, test and tool configurations.
- `pnpm --filter @envoy1084/effect-redis lint`: source, tests, support and tooling.
- `pnpm --filter @envoy1084/effect-redis build`: unbundled ESM/declarations plus Publint.
- `pnpm test:protocol:fuzz`: built-artifact fuzz/large-input corpus under an external watchdog.
- `pnpm check:spec`: tracked inventory/fixture/scenario validation.
- `pnpm check`: the complete workspace checks.

Default tests require no Redis process, credentials or network access. `pnpm test:node`
is a separate live lane requiring Docker, OpenSSL and images prepared with
`pnpm fixtures:pull`. It runs disposable Redis/Valkey fixtures; it never uses hosted
endpoints or automatically downloads prerequisites. Provider certification is pending.

Licensed under Apache-2.0. Package archives include the license and built artifacts;
`prepack` rebuilds them, and pnpm replaces catalog references with compatible ranges.

Node transport accepts a validated `RedisConfig` inside an Effect scope. `read`
returns owned nonempty bytes or `undefined` for clean EOF; `write` applies bounded
backpressure; `close` is idempotent and wakes pending operations. Only one reader and
writer may own a connection. Canceling an active write retires that socket because
a prefix may have been sent. Local write completion does not prove server execution.

TLS verifies trust and identity by default and supports explicit SNI, custom CAs and
client certificates. Acquisition includes the TLS handshake and connect deadline;
Redis AUTH/HELLO/SELECT and reconnection policies belong to the later connection engine.
