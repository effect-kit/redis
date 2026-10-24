# Foundation contracts

Phase 01 implements configuration decoding and offline test/specification validation.
Phase 02 adds the [RESP codec](protocol.md), which enforces protocol limits. There
is no network adapter, connection scheduler or command client yet. Those later
implementations must enforce their remaining settings.

## Configuration

`decodeRedisConfig(unknown)` returns `Effect<RedisConfig, RedisConfigError>`.
It validates with Effect Schema, rejects unknown fields and returns normalized
options. Expected errors expose a safe field path and reason; they retain neither
rejected values nor Schema issue trees.

```ts
import { Effect } from "effect";

import { decodeRedisConfig } from "effect-redis";

const configuration = Effect.gen(function* () {
  return yield* decodeRedisConfig({
    endpoint: { url: "rediss://localhost:6379/0" },
    protocol: "resp3",
    limits: { maxQueuedCommands: 256 },
  });
});
```

Choose one endpoint shape:

- `{ url: "redis://host:6379/0" }` or `rediss:` for TLS. An omitted database is 0.
  Both schemes default to port 6379. IPv6 literals are normalized without brackets.
- `{ host: "localhost", port: 6379 }`, optionally with `tls`.
- `{ path: "/absolute/path/redis.sock" }` for a future Unix socket adapter.

URL query strings/fragments, unsupported schemes, invalid databases and conflicting
endpoint shapes are rejected. A trailing `/` means the default database. Credentials
are percent-decoded once. Choose URL credentials or an explicit
`credentials: { username?, password }`, and choose a URL database or an explicit
`database`; specifying both is an error even when their values match.

TLS options accept `serverName`, `ca`, paired `certificate`/`privateKey`, and
`rejectUnauthorized` (default true). Material is nonempty PEM text, not a filename;
certificate trust and cryptographic validation belong to the actual TLS adapter.
Use `rediss:` when combining URL endpoints with TLS options. Credentials and TLS
material become Effect `Redacted` values; the normalized config contains no URL.
Deliberate access through `Redacted.value` belongs at an adapter boundary.

`protocol` is `resp2`, `resp3` or `auto` (default). Automatic negotiation/fallback
is implemented in phase 04. `clientName` accepts nonempty visible ASCII without
spaces. The current configuration covers native connections; HTTP/topology-specific
configuration is added with its owning implementation.

## Resource budgets

All budgets/timeouts are positive safe integers. `database` is a nonnegative safe
integer; TCP ports are 1–65535. Header and blob limits must fit the buffered-byte limit.

| Setting                    |    Default | Unit         |
| -------------------------- | ---------: | ------------ |
| connectTimeoutMillis       |     10,000 | milliseconds |
| commandTimeoutMillis       |     30,000 | milliseconds |
| limits.maxHeaderBytes      |      1,024 | bytes        |
| limits.maxBlobBytes        | 67,108,864 | bytes        |
| limits.maxBufferedBytes    | 67,109,888 | bytes        |
| limits.maxAggregateEntries |  1,000,000 | entries      |
| limits.maxNestingDepth     |        128 | levels       |
| limits.maxQueuedCommands   |      1,024 | commands     |
| limits.maxInFlightCommands |        128 | commands     |
| limits.maxQueuedBytes      | 16,777,216 | bytes        |
| limits.maxInFlightBytes    | 16,777,216 | bytes        |

These are initial policy defaults, not measured throughput/memory guarantees. The codec now enforces protocol limits (phase 02); the scheduler enforces its
remaining budgets in phase 04. Phase 19 measures process/workload budgets.

## Values and transport

`RedisArgument` remains `string | Uint8Array`. `RespValue` is a discriminated union
preserving bytes, exact integers/big numbers, null wire variants, ordered map pairs,
sets, arrays, nested errors, verbatim format bytes, pushes and decorating attributes.
Doubles retain their wire token so special values and decimal spelling are not lost.
The representation itself does not validate framing; the phase-02 codec owns wire grammar.

The internal `transport/Transport` service acquires one scoped physical byte
connection. A single owner reads nonempty chunks (undefined denotes EOF), and a
single writer awaits acceptance of all bytes with backpressure. A failed write can
follow partial acceptance. Close is idempotent and wakes pending operations. Native
adapters must also register scoped cleanup; a close failure must remain observable.
The interface makes no retry, handshake or reconnect promise.

The controlled test transport substitutes only this byte boundary. It has explicit
write acceptance/failure barriers, incoming chunks/EOF/failures, copied observations,
and handle counters. Each fixture permits one acquisition, bounds queues to 16,
chunks/writes to 64 KiB, and outgoing captures to 64 KiB/256 fragments. It does not
parse commands or reproduce the future request scheduler. Phase 04 adds controls
only when real scheduler tests need them.

## Testing and specifications

`pnpm test` runs nonempty offline Vitest suites. `it.effect` supplies scoped test
services; fixture timeout tests use TestClock after an explicit write barrier.
Manifest tests use `it.live` for actual local file reads. Source, tests and tooling
are independently typechecked with TypeScript 7. No `.env` loading or real service
access is part of this lane.

The tracked [specification inventory](../../spec/README.md) is validated by these
tests and by `pnpm check:spec`. Turbo includes `spec/**` in its global input hash.
Future external-evidence tasks must use `cache: false`; none is advertised as a
passing placeholder today. Build and package files exclude tests/tools/spec/research.
