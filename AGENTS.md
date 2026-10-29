# Working on Effect Redis

## Before changing code

- Inspect `git status --short`, relevant source/tests/configuration and recent commits.
  Preserve pre-existing work and commit unrelated changes separately.
- Read `node_modules/effect/AGENTS.md` before writing Effect code. Verify APIs against
  installed documentation/source; do not copy Effect v3 or old beta examples.
- Keep changes focused, preserve public behavior, and commit meaningful changes
  with Conventional Commits. Do not push, publish or create release tags without permission.

## Workspace and dependencies

- Library: `packages/redis`; npm name: `@effect-kit/redis`. Use pnpm and the
  Node/Bun versions pinned in the repository. Keep the workspace root private.
- Effect v4 is the only runtime peer; the supported range is `^4.0.6`. Changes to
  the minimum require behavior tests, including interruption and cleanup.
- Use catalog ranges and commit `pnpm-lock.yaml`. CI installs with `--frozen-lockfile`.
  Do not add dependencies when existing tools/platform APIs suffice.
- Use TypeScript 7, tsdown/Klarity, Oxlint and Oxfmt; no `.editorconfig`.
  Keep the tsdown/TypeScript declaration-plugin compatibility constraints in the catalog.
- Keep universal exports runtime-neutral. Native APIs belong behind `/node` and
  `/bun`; HTTP belongs behind `/upstash`. Never wrap another Redis client.
- Keep package/root Apache licenses identical and published files limited to the
  declared exports, README, changelog and license.

## Code conventions

- Keep modules focused; split by domain/responsibility near 400–500 lines.
  Group command families in folders instead of one command file.
- Use `#/` for source imports and `#test/` for test-owned modules. Relative URLs
  for assets and root-owned tooling imports are boundary exceptions.
- Separate declarations and logical steps with blank lines. Add short comments
  only for non-obvious invariants, ownership, compatibility or trade-offs.
- Reuse existing abstractions. Extract shared code only for actual reuse or a
  meaningful boundary; avoid catch-all utilities and speculative layers.
- Preserve exact public types, tagged errors, defects and interruption. Do not
  swallow failures, coerce arbitrary replies or auto-serialize application values.

## Effect and protocol contracts

- Use class-based `Context.Service`, composable Layers, `Effect.gen`, and
  `Effect.fn`/`fnUntraced`. Keep runtime runners at application/test edges.
- Resources and workers belong to a Scope through `Effect.acquireRelease`.
  Reuse ready `RedisNode`/`RedisBun`/`RedisUpstash` Layers in consumer examples.
- Use Schema at configuration/payload boundaries and tagged errors for expected
  failures. Bound queues, bytes, concurrency and deadlines. Keep secrets Redacted.
- Preserve binary bytes, RESP types, exact integers, nested errors and attributes.
  Drain the incremental decoder between bounded feeds; malformed framing retires
  its connection generation.
- Native ownership shortcuts are private capabilities. Public feeds/writes retain
  snapshots; unknown transports use the copying fallback. Bound backing stores too.
- One physical connection owns ordered writes and reply slots. Cancellation after
  possible write retires the generation; never silently replay uncertain commands.
- Compiled plans own bounded input snapshots; only private immutable tuples may cache
  wire frames. Recheck admission, profiles, routing and deadlines on every execution.
  Keep decoder services in the executing fiber and reject plans after client scope closure.
- Ordinary batches share native FIFO ownership; preserve indexed evidence and retire
  the generation after uncertain cancellation. Keep provider session/routing guarantees.
- Pipelines are ordered, not atomic. WATCH/transactions/blocking operations and
  next-command state require the correct exclusive connection ownership.
- Cluster, Sentinel, ordinary native and HTTP execution have distinct capabilities.
  Reject unsupported routing/state rather than emulate server guarantees.
- HTTP has no physical sessions; preserve its binary/JSON/SSE limits. Upstash
  Search/Vector dialects remain separate from Redis module commands.
- Scope compatibility claims to executed versions/configurations/scenarios.
  Command acceptance, profiles and local fixtures do not certify hosted providers.

## Tests and verification

- Keep tests under `packages/redis/test/`: `unit`, `integration`, `e2e`, `fixtures`,
  `support`, `runners` and compile-only `types`. Keep two Vitest configurations:
  offline and explicit live. Preserve the universal/native/development TS boundaries.
- Use `@effect/vitest` for Effect workflows, Vitest for pure code, TestClock for
  deterministic races, and real scoped fixtures for networking. Test behavior and
  failures; do not build a fake Redis or tests that merely mirror implementation.
- Run `pnpm check` for format, lint, types, offline tests and build. Run
  `pnpm test:artifacts` when public docs, metadata, exports or declarations change;
  it checks exact archives and compiles the actual README examples.
- Run affected live cases for transport/fixture/backend changes and
  `pnpm test:protocol:fuzz` for protocol/byte ownership changes. Prefer focused
  reruns; do not repeat the full matrix without a relevant change or failure.
- Live fixtures need Docker, OpenSSL, pinned Bun and explicitly prepared images:
  `pnpm fixtures:check`, then `pnpm fixtures:pull`. Missing prerequisites fail.
  Use Testcontainers lifecycle APIs, no container reuse or automatic image pulls.
- Allocate loopback ports on the host. Writable bind mounts use the host UID/GID.
  Await socket/process/container cleanup; never mask binding or permission errors.
- Never rebuild a checkout while live children mount its `dist/`. Preserve owned
  release/provider/artifact/hardening/benchmark evidence when clearing regular test results.
- Endpoint mode performs connection authentication and read-only PING/ECHO only.
  Mutating tests use disposable fixtures and unique keys; never flush shared servers.
- `pnpm bench:clients` is an opt-in Node comparison with development-only drivers.
  Keep competitor imports under test/runners/benchmarks, fresh-process isolation,
  recorded batching/execution policies and complete per-trial evidence. Never add
  these workloads to normal tests/releases or claim rankings from smoke samples.
- Report exact checks run, failures and skipped gates. Unobserved remote/provider
  checks are not passing evidence.

## CI and releases

- Offline CI runs on ordinary PRs/main pushes; same-repository bot-created Changesets
  version PRs skip the check job. `ci:check` and `release:prepare` run fast checks;
  fuzzing and repeated artifact builds live in the manual Extended tests workflow.
  Live, hosted-provider and release workflows
  are dispatch-only. Use current major action tags and the shared setup action.
  Keep checkout refs explicit and tested commits immutable.
- Keep trusted PR selection/reporting separate from untrusted tests. PR test jobs
  receive read-only permissions, no provider secrets and no shared cache writes.
- Use repository Actions secrets, no workflow environment bindings. Worker tests
  require an owned empty deployment and verified code/binding restoration.
- Changesets owns versions/changelogs. Keep version-PR permissions separate from
  OIDC publication. Publish only the verified archive, without rebuilding it.
- Release runs fast offline/package checks, without Docker or live backends. Use
  `--skip-live` for its archive/registry probes; keep full conformance dispatch-only.
  Extended tests owns the three-build artifact suite; Release checks the exact archive once.
- Release defaults to verification-only (`dry-run: true`), including temporary local versioning.
  Disable it explicitly to create a version PR or publish. Root release check/smoke scripts
  include `--skip-live`; call package test runners directly for full live consumer checks.
- `release:pack`/`release:check` prepare and verify; `release:smoke` checks an actual
  registry publication. These verification commands do not publish.
- Release does not wait for registry availability or run registry smoke checks.
  Run `release:smoke` separately after the published version becomes available.

## Documentation and progress

- Keep public READMEs concise and consumer-facing. Detailed architecture, research,
  phase plans/reports and progress belong in ignored `/research/`, never Git.
- Keep root `BENCHMARKS.md` concise and table-first: essential setup, throughput,
  comparisons and reproduction. Link `benchmarks/` for full latency/resource data;
  keep detailed analysis and local runs ignored.
- Test inputs/runners stay tracked and self-contained. Builds, tests, CI and package
  contents must work without research or local secrets. Never force-add ignored files.
- When working on a phase, inspect local progress/backlog if present and update its
  report under `research/docs/progress/reports/`. Record verified work, deferred
  items, owners and next actions; keep unfinished gates open.
