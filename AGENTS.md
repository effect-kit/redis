# Effect Redis agent guide

## Scope and status

Build a native Redis-compatible client with Effect v4. This repository currently
contains workspace tooling and a private library scaffold, not a working Redis client.
Never describe planned command or server compatibility as implemented or verified.

## Read before changing code

1. Inspect `git status --short`, the relevant source, package README, configuration,
   tests, and recent commits. Preserve existing work. Commit pre-existing unstaged
   changes separately before implementation; never mix unrelated changes.
2. Read `node_modules/effect/AGENTS.md` completely before writing Effect code. Follow
   the relevant links under `node_modules/effect/ai-docs/` and inspect installed source
   for exact APIs. The catalog currently pins Effect **4.0.6**; do not copy v3 or old
   beta examples or assume that `effect/unstable/*` imports still exist.
3. Read this guide's architecture decisions before adding protocol or transport code.
   Keep provisional investigations in ignored `/research/`; maintained docs and
   builds must never require that directory.

## Dependency and workspace policy

- Use pnpm **12.14.0**, Node **24.22.0+**, Turborepo, TypeScript **7.0.2**, and Klarity
  presets. Commit `pnpm-lock.yaml`; use `pnpm install --frozen-lockfile` in CI.
- Keep shared versions exact in the default catalog in `pnpm-workspace.yaml` and use
  `catalog:` in manifests. Keep runtime Effect versions aligned across packages.
- Effect v4 is the only permitted library runtime dependency/peer. Use platform
  TCP/TLS, bytes, and HTTP APIs at adapter boundaries. Do not add ioredis, node-redis,
  Bun.RedisClient, Upstash SDKs, RESP parsers, or unrelated runtime libraries.
- Development tools are allowed. Prefer installed tools and platform APIs; explain
  any necessary addition. Klarity supplies configuration, not the compiler binaries.
- Start in `packages/redis`; create packages only for a real consumer, runtime,
  dependency, or ownership boundary. Keep universal exports free of Node/Bun imports.
- The package remains private until publishing is explicitly in scope. Do not add
  release automation or publish packages as part of routine implementation.

## Effect v4 conventions

- Model capabilities with class-based `Context.Service` and compose them with `Layer`.
  Use `Layer.effect` with scoped acquisition and `Effect.acquireRelease`; socket,
  subscription, and worker lifetimes belong to a `Scope`.
- Prefer `Effect.gen` inline and `Effect.fn` for traced operations. Use
  `Effect.fnUntraced` for library hot paths. Return with `return yield* error` when
  failing from a generator. Keep runtime runners at application and test edges.
- Use `Schema` for untrusted configuration and application payloads, and
  `Schema.TaggedError` for expected failures. Protocol byte framing requires an
  incremental byte parser; Schema does not replace RESP framing.
- Use Effect `Queue`, `Deferred`, `Semaphore`, `PubSub`, `Stream`, `Schedule`, `Clock`,
  and `Config` where their semantics fit. Bound buffers and concurrency. A local
  Effect collection does not replace a remote Redis data structure.
- Keep secrets in `Redacted`; never log credentials, full connection URLs, keys,
  values, Lua bodies, or bearer tokens by default.

## Engineering workflow

- Make the smallest coherent change. Preserve public behavior and existing naming,
  module, error, and formatting patterns. Do not refactor unrelated code.
- Keep modules focused; review source files approaching 300–500 lines. Split by
  domain or responsibility, not arbitrary size. Large generated catalogs are exempt.
- Extract only reused logic, important domain concepts, or boundaries that materially
  improve readability/testing. Avoid generic helpers, wrappers, speculative services,
  dead code, debug logging, and comments that repeat the implementation.
- Use explicit shallow control flow and domain-specific names. Propagate or translate
  errors at their owning boundary; never silently swallow them.
- Add tests for meaningful behavior, public APIs, security boundaries, and regressions.
  Use Node's built-in test runner initially; run Effect at the test boundary and use
  Effect's installed testing utilities when needed. Do not test placeholder exports.
- Run `pnpm check` after meaningful changes. It covers format, lint, root/package
  typechecks, package tests, and builds. There are no behavioral tests yet; add them
  with the first protocol implementation. Report any skipped checks and their reason.
- Check emitted artifacts and package contents before a release. Never include
  ignored research, secrets, fixtures, or local runtime state in a published package.
- Update concise maintained documentation when behavior, configuration, commands,
  dependencies, or architecture change. Research is local evidence, not required docs.
- Create a commit after each meaningful, self-contained change using Conventional
  Commits. Lefthook formats/lints staged code and validates messages; pre-push runs
  workspace lint, typecheck, and tests. Hooks supplement CI and do not replace it.

## Architecture decisions

The research-backed design is recorded here as the foundation is established.
Implementation details must be checked against the installed Effect version and
real server tests before becoming public API promises.
