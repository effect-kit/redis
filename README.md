# Effect Redis

A Redis protocol client built with Effect v4 and runtime platform APIs. The goal is
complete command coverage, binary-safe RESP2/RESP3, and explicit capabilities across
Redis-compatible servers and transports.

**Status:** Phase 02: bounded binary RESP request encoding and incremental RESP2/RESP3
decoding, including declared streamed forms, with validated configuration and offline
tests. Network connections and command execution are not implemented. Server
compatibility remains a target.

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

| Command                   | Purpose                                                  |
| ------------------------- | -------------------------------------------------------- |
| `pnpm build`              | Build workspace packages through Turborepo               |
| `pnpm typecheck`          | Check root configs, source, tests and tooling            |
| `pnpm lint`               | Lint root configs, source, tests and tooling             |
| `pnpm format`             | Format tracked project files with Oxfmt                  |
| `pnpm format:check`       | Check formatting                                         |
| `pnpm test`               | Run offline Effect Vitest/unit/specification tests       |
| `pnpm test:protocol:fuzz` | Build and run the watchdog protocol corpus               |
| `pnpm check:spec`         | Validate tracked release/fixture/scenario specifications |
| `pnpm check`              | Formatting, lint, typecheck, test, and build             |

## Workspace

- `packages/effect-redis`: the private `@envoy1084/effect-redis` library foundation.
- `pnpm-workspace.yaml`: shared compatible dependency ranges in the default pnpm catalog.
- `AGENTS.md`: engineering policy and architecture guidance for contributors and agents.
- [Release specifications](spec/README.md): tracked command/fixture/scenario inventory.
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
