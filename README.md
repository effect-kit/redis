# Effect Redis

A Redis protocol client built with Effect v4 and runtime platform APIs. The goal is
complete command coverage, binary-safe RESP2/RESP3, and explicit capabilities across
Redis-compatible servers and transports.

**Status:** workspace and architecture foundation. No Redis client functionality is
implemented yet. Compatibility is a target, not a claim about this scaffold.

## Development

Use Node.js 24.22.0 or newer and pnpm 12.14.0 (pinned in `packageManager`).

```sh
pnpm install
pnpm check
```

`pnpm install` installs Lefthook. Klarity supplies TypeScript, Oxlint, Oxfmt,
Commitlint, and Git hook conventions. TypeScript 7 emits unbundled ESM and declarations
directly; no additional bundler is needed for this scaffold.

| Command             | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `pnpm build`        | Build workspace packages through Turborepo         |
| `pnpm typecheck`    | Check root tool configs and workspace source       |
| `pnpm lint`         | Lint root tool configs and workspace source        |
| `pnpm format`       | Format tracked project files with Oxfmt            |
| `pnpm format:check` | Check formatting                                   |
| `pnpm test`         | Run package tests through Turborepo (no tests yet) |
| `pnpm check`        | Formatting, lint, typecheck, test, and build       |

## Workspace

- `packages/redis`: the private `effect-redis` library scaffold.
- `pnpm-workspace.yaml`: shared, exact dependency versions in the default pnpm catalog.
- `AGENTS.md`: engineering policy and architecture guidance for contributors and agents.
- `research/`: ignored local Markdown investigations and upstream metadata; never commit it.

Effect is installed at the workspace root so its `AGENTS.md`, AI documentation, and
source are available locally. Effect is the library's only intended runtime peer;
tooling packages are development dependencies. No existing Redis client or protocol
parser is used. Commit meaningful changes separately using Conventional Commits.
