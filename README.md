# Effect Redis

A Redis protocol client built with Effect v4 and runtime platform APIs. The goal is
complete command coverage, binary-safe RESP2/RESP3, and explicit capabilities across
Redis-compatible servers and transports.

**Status:** The typed Redis service covers 187 ordinary commands across strings,
hashes, lists, sets, keys/TTL, sorted sets, bitmaps, HyperLogLog, geo and arrays.
Scoped Node TCP/TLS/Unix, bounded scheduling and lossless RESP2/RESP3 are implemented.
Native sessions add scoped leases, typed pipelines/transactions, WATCH workflows,
nine blocking list/sorted-set commands and connection-relative controls. Cursor scans
and Redis Streams add typed commands, scoped readers and consumer recovery/processing.
Subscriptions, scripting, topologies and broader runtime/provider certification follow.

## Development

Use Node.js 24.22.0 or newer and pnpm 12.14.0 (pinned in `packageManager`).

```sh
pnpm install
pnpm check
```

`pnpm install` installs Lefthook. Klarity supplies TypeScript, Oxlint, Oxfmt,
Commitlint, and Git hook conventions. TypeScript 7 checks types;
tsdown uses Klarity’s library preset to build unbundled ESM and declarations, with
Publint checking package exports.

| Command                   | Purpose                                               |
| ------------------------- | ----------------------------------------------------- |
| `pnpm build`              | Build workspace packages through Turborepo            |
| `pnpm typecheck`          | Check source, tests and public type contracts         |
| `pnpm lint`               | Lint root configs, source and tests                   |
| `pnpm format`             | Format tracked project files with Oxfmt               |
| `pnpm format:check`       | Check formatting                                      |
| `pnpm test`               | Run offline unit and controlled integration tests     |
| `pnpm test:protocol:fuzz` | Build and run the watchdog protocol corpus            |
| `pnpm fixtures:check`     | Validate pinned backend test fixtures                 |
| `pnpm fixtures:pull`      | Explicitly download pinned integration-test images    |
| `pnpm test:node`          | Alias for the full live suite                         |
| `pnpm test:live`          | Run live socket/fault and twelve server-version cases |
| `pnpm check`              | Formatting, lint, typecheck, test, and build          |

## Workspace

- `packages/effect-redis`: the private `@envoy1084/effect-redis` library foundation.
- `pnpm-workspace.yaml`: shared compatible dependency ranges in the default pnpm catalog.
- `AGENTS.md`: engineering policy and architecture guidance for contributors and agents.
- [Tests](packages/effect-redis/test/README.md): unit/integration/e2e suites, fixtures and runners.
- `research/`: ignored local docs, plans, phase reports and investigations.
  These files are private and never required by the build, tests or CI.

Effect is installed at the workspace root so its `AGENTS.md`, AI documentation, and
source are available locally. Effect is the library's only intended runtime peer;
tooling packages are development dependencies. No existing Redis client or protocol
parser is used. Commit meaningful changes separately using Conventional Commits.

## Architecture direction

Implement native RESP2/RESP3 over scoped TCP/TLS, typed Effect commands, and Stream
helpers for subscriptions, cursor scans, and Redis Stream consumption. Node and Bun
supply socket adapters; Upstash HTTP uses a separate executor with explicit transport
capabilities. Server versions, modules, and provider restrictions determine actual
command availability.

The maintained [agent guide](AGENTS.md) records module boundaries, binary safety,
cancellation and replay rules, transactions, topology, and implementation milestones.
Local research catalogs are split by category under `research/redis-commands/`,
`research/valkey-commands/`, and `research/upstash-commands/`.

## Dependencies and license

Catalog ranges allow compatible updates; `pnpm-lock.yaml` records exact resolutions
for reproducible installs. Effect uses `^4.0.6`, TypeScript stays within `~7.0.2`,
and tsdown is constrained to `>=0.23.1 <0.23.2` until its declaration plugin supports
our compiler. Use frozen installs in CI and review lockfile updates.

Licensed under [Apache-2.0](LICENSE). The library remains private during development.

Node networking is exposed through `@envoy1084/effect-redis/node`. Default live tests
use disposable Testcontainers fixtures and require a local Docker-compatible daemon,
OpenSSL and explicitly prepared images. `pnpm check` stays offline.

```sh
pnpm fixtures:pull                     # or --engine valkey
pnpm test:live                         # all engines and socket/fault tests
pnpm test:live --engine valkey         # selected engine, all pinned versions
pnpm test:live --mode binary --engine redis --binary /absolute/path/redis-server
# Explicit existing endpoint: set EFFECT_REDIS_TEST_URL privately in your shell.
pnpm test:live --mode endpoint         # AUTH if needed, PING/ECHO only; no writes
```

The matrix pins Redis 6.2.19/7.2.11/7.4.6/8.10.2, Valkey 7.2.11/8.0.3/9.1.2,
Dragonfly 2.0.2, KeyDB 6.3.4, Redict 7.3.6, Garnet 2.2.4 and Kvrocks 2.17.0.
All seven engines have transport and isolated binary state smoke tests. Ordinary
command-family conformance runs on the seven pinned Redis/Valkey builds in RESP2/3,
including explicit errors for unavailable commands/options. Full engine, topology,
module and hosted-provider certification remains pending. Bun is a runtime, rather
than a server fixture. Endpoint mode also accepts `EFFECT_REDIS_TEST_CA` for a custom
CA file; it never downloads images or starts/stops the external server.

Live CI runs on every push to `main`. PRs run offline checks automatically. Writers
can comment `/test live` on a PR for the full suite, or `/test live valkey` for a
selected engine (`core` selects socket/TLS fault tests). The **Live conformance**
workflow also supports manual dispatch with an optional PR number and suite. Manual
PR runs test the exact resolved head SHA with read-only permissions; reports link
that SHA to individual matrix results and artifacts. The workflow must be present on
the default branch before comment/dispatch triggers become available.
