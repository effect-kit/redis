# Effect Redis agent guide

## Scope and status

Build a native Redis-compatible client with Effect v4. This repository currently
contains a bounded RESP codec, validated configuration, scoped Node byte transports,
offline/live networking tests, and test-owned fixtures. The ordinary connection
engine implements handshake, bounded admission/reply ownership, cancellation, shutdown
and future-work reconnection. Phase 05 adds the Redis service, typed descriptors,
explicit payload/key codecs and a PING/GET/SET/INCR/ZSCORE slice. Phase 06 adds
187 ordinary data commands with unit/type/composition tests and primary Redis/Valkey
conformance. Phase 07 adds native leases, pipelines/transactions, WATCH, blocking
operations and connection-relative controls with controlled/public-type tests and
primary Redis/Valkey conformance. Detailed verification is tracked privately.
Phase 08 adds typed scans/Streams, scoped readers, pending/claim recovery, processing
policies and explicit payload envelopes with controlled/type/primary Redis/Valkey
conformance and packed/fresh-consumer verification.
Phase 09 adds scoped Pub/Sub, explicit recovery gaps, managed tracking and bounded
GET-byte caches with controlled/type/primary Redis/Valkey conformance.
Phase 10 adds typed Lua/functions, bounded script loading, explicit administration,
public HIMPORT/BACKUP operations and isolated MONITOR/SHUTDOWN modes.
Phase 11 adds native client-routed Redis/Valkey Cluster, node-bound sessions/scripts,
bounded topology recovery and topology-bound event/cache lifetimes. Phase 12 adds native
Redis/Valkey Sentinel discovery, role-verified data admission and future-work failover.
Phase 13 adds typed JSON, Search, TimeSeries, probabilistic and vector-set families,
explicit Schema/FP32 codecs, leased Search cursors and separate pinned module fixtures.
Module availability and dialects remain specific to the actual enabled versions.
The `/bun` adapter adds scoped native TCP/TLS/Unix and Crypto with actual Bun host
and pinned Linux runtime scenarios. Shared command, session and topology code stays
runtime-neutral; record exact runtime/platform evidence before compatibility claims.
The `/upstash` adapter adds bounded Effect HTTP execution, JSON transactions and text
SSE, plus separate provider Search/Vector/ACL descriptors. Controlled provider contracts
and owned local Uprest fixtures are distinct from hosted certification (Phase 18).
Never describe planned command or server compatibility as implemented or verified.
Phase 16 adds ready runtime/topology Layers, deployment-scoped credential refresh,
explicit socket/request rotation and managed-service policies. Hosted certification
remains pending; official profile metadata and local fixtures do not close phase 18.
Engine conformance uses shared built-artifact Node/Bun scenarios across seven pinned
native engines, with separate host/Linux and enabled-Garnet-Lua configurations.
Compatibility belongs to exact image/build/configuration/runtime/protocol/scenario
records, not to an engine family or its COMMAND listing.

## Read before changing code

1. Inspect `git status --short`, the relevant source, package README, configuration,
   tests, and recent commits. Preserve existing work. Commit pre-existing unstaged
   changes separately before implementation; never mix unrelated changes.
2. Read `node_modules/effect/AGENTS.md` completely before writing Effect code. Follow
   the relevant links under `node_modules/effect/ai-docs/` and inspect installed source
   for exact APIs. The lockfile currently resolves Effect **4.0.6**; do not copy v3 or old
   beta examples or assume that `effect/unstable/*` imports still exist.
3. Read this guide's architecture decisions before adding protocol or transport code.
   Keep detailed docs, research and phase reports under ignored `/research/`.
   Test-required data and runners stay tracked under `packages/effect-redis/test/`. Builds, tests, CI and
   published artifacts must never require research. Use Oxfmt/Oxlint configuration;
   do not add `.editorconfig`.

## Dependency and workspace policy

- Use pnpm **12.14.0**, Node **24.22.0+**, Turborepo, TypeScript **7.0.2**, and Klarity
  presets. Build libraries with tsdown and `klarity/tsdown/library`; keep
  TypeScript 7 for typechecking. Commit `pnpm-lock.yaml`; use `pnpm install --frozen-lockfile` in CI.
- Keep tsdown within **>=0.23.1 <0.23.2** and TypeScript within **~7.0.2**. Its declaration plugin
  supports this compiler; tsdown 0.23.2's plugin requires the TypeScript 7.1 API.
  Recheck the pair before upgrades; do not downgrade to TypeScript 6 or force isolated
  declarations just to bypass an incompatible declaration emitter.
- Keep shared compatible ranges in the default catalog in `pnpm-workspace.yaml` and
  use `catalog:` in manifests. Prefer caret ranges for stable dependencies, narrow
  known toolchain incompatibilities, and commit exact resolutions in pnpm-lock.yaml.
  Keep runtime Effect versions aligned across packages; the public Effect peer range
  is **^4.0.6**. Review compatibility before widening its major version.
- Effect v4 is the only permitted library runtime dependency/peer. Use platform
  TCP/TLS, bytes, and HTTP APIs at adapter boundaries. Do not add ioredis, node-redis,
  Bun.RedisClient, Upstash SDKs, RESP parsers, or unrelated runtime libraries.
- Development tools are allowed. Prefer installed tools and platform APIs; explain
  any necessary addition. Klarity supplies configuration, not the compiler binaries.
- Bun development uses `.bun-version` and matching `@types/bun` 1.4.4. Keep native
  type declarations within the tested patch until API compatibility is reviewed.
  Bun's `/bun` entrypoint owns native sockets/Crypto; universal code imports neither
  runtime adapter. Before TCP establishment native Bun has no abort handle, so join
  acquisition settlement and close late sockets rather than abandoning them.
- Start in `packages/effect-redis`; create packages only for a real consumer, runtime,
  dependency, or ownership boundary. Keep universal exports free of Node/Bun imports.
  Node transport lives behind `@envoy1084/effect-redis/node`; keep the universal
  typecheck free of Node globals and verify both entrypoints from a packed artifact.
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
- Review readability file by file. Put blank lines between declarations and distinct
  validation, acquisition, scheduling, cleanup and result steps. Separate test setup,
  action and assertions where they form distinct steps. Do not pad every statement,
  add banner comments or apply blanket regex formatting across files.
- Add short comments where readers need a protocol invariant, ownership/lifetime
  reason, compatibility constraint or non-obvious type/precision trade-off. Preserve
  useful existing comments; do not narrate obvious statements.
- Use package imports: `#/` for src and `#test/` for all test-owned modules.
  Do not add relative imports between package modules. Relative file URLs for assets/
  built-artifact probes and the root-owned CI policy test are boundary exceptions.
  Verify aliases with native Node tools, Vitest, TS7 and the packed build; generated
  JS/declarations must resolve independently of unshipped source files.
- Prefer the ready `RedisNode`/`RedisBun`/`RedisUpstash` Layer constructors in consumer
  examples. Preserve existing lower-level factories/exports for custom composition.
  Native `layer`, `layerCluster`, `layerSentinel` and Config variants choose topology
  explicitly; engines share native protocol composition. Reuse Layer values so helpers
  share the ordinary engine and lease pool. Keep physical-session capabilities absent
  from HTTP and topology-specific sessions bound to Cluster/Sentinel ownership.
- Keep configuration boundaries explicit: tsconfig.json checks universal code without
  Node globals, tsconfig.node.json emits native declarations, and tsconfig.dev.json
  checks source/tests/configs including compile-only contracts. The native declaration
  config includes Node/Bun types; universal checking excludes both adapters. Keep two Vitest configs
  under test/: the default offline lane and an explicitly selected live lane. Do not
  create a config per folder, engine or version.
- Keep handwritten source and test files below 500 physical lines; review splitting
  near 400. Split by domain, operation group or responsibility, not arbitrary size.
  Use folders/subfolders for related ownership. Generated metadata and indivisible
  declarative fixtures are exceptions; record provenance and the reason in the phase report.
- Extract only reused logic, important domain concepts, or boundaries that materially
  improve readability/testing. Avoid generic helpers, wrappers, speculative services,
  dead code, debug logging, and comments that repeat the implementation.
- Use explicit shallow control flow and domain-specific names. Propagate or translate
  errors at their owning boundary; never silently swallow them.
- Keep comments short and limited to non-obvious invariants, protocol/compatibility
  constraints, units or trade-offs. Do not narrate obvious code. Public JSDoc explains
  meaningful input/result/error semantics rather than repeating function names.
- Add tests for meaningful behavior, public APIs, security boundaries, and regressions.
  Use `@effect/vitest` for Effect workflows and ordinary Vitest for pure code. The
  lockfile resolves @effect/vitest 4.0.6, Vitest 5.0.5 and Vite 8.3.5. Inspect exact
  installed APIs: v4 `it.effect` and `it.live` already provide Scope. Use TestClock for deterministic policy/race tests, live services for
  real sockets/processes/providers, and shared Layers only with explicit isolation.
  Keep typed fixtures/support modules reusable and focused; do not build a fake Redis
  implementation or use broad mocks that bypass the production scheduler. Typecheck
  tests separately from production. Do not test placeholder exports or merely Effect itself.
- Keep all package test concerns under test/: unit for focused components, integration
  for composition/platform boundaries, e2e for public client behavior against real
  backends, fixtures for inputs, support for reusable infrastructure, runners for CLI/
  child programs, and types for compile-only contracts. Docker use does not determine
  a test's category. Split mixed unit/integration files by the boundary they prove.
- Keep only data consumed by real tests or runners. Do not retain descriptive JSON
  catalogs through bookkeeping tests. Fixture validation must run before image pulls/
  acquisition; written scenarios and progress belong in ignored research.
- `pnpm test` runs offline unit and controlled integration suites; `test:unit` selects
  only unit tests. `pnpm test:live` explicitly selects native/backend integration and
  e2e suites. Both configs disable env-file loading and fail on empty selections.
  Keep generated evidence in ignored test/results/ and update CI artifact paths when
  moving it. Test data must remain independent of research and package artifacts.
- Run `pnpm test:node` when native transport, fixtures or socket ownership changes.
  It needs Docker, OpenSSL and explicitly prepared images (`pnpm fixtures:pull`).
  The default lane uses scoped Testcontainers fixtures, digest-pinned engine/Node/Ryuk
  images, loopback ports and awaited cleanup. Never reuse containers across runs or
  automatically pull images during tests. Own cleanup before starting; use the
  Testcontainers runtime API for lifecycle/volumes, not Docker CLI subprocesses.
  Docker readiness uses its configured overall deadline; do not add an independent
  attempt cap that ends startup early when connection failures return quickly.
  Backend startup profiles must preserve actual configuration/module differences.
  Missing prerequisites fail; they are not passing skips.
  Do not rebuild or pack the same checkout while live probes mount its dist/ folder;
  use separate checkouts for independent artifact verification.
- `pnpm test:live --engine redis|valkey|dragonfly|keydb|redict|garnet|kvrocks|core`
  selects a live suite. Default `all` runs every engine and socket/fault case.
  Runtime selection is independent: `--runtime node|bun|all`, with both runtimes
  selected by default for container mode. `test:node` and `test:bun` select one.
  Bun scenarios use compiled entrypoints in real pinned Bun processes, plus Linux
  container probes. Validate `.bun-version` and fixture metadata before acquisition.
  `--mode binary --engine redis|valkey --binary /absolute/path` owns a temporary native
  server process. `--mode endpoint` requires explicit `EFFECT_REDIS_TEST_URL` and uses
  connection-only AUTH plus read-only PING/ECHO; optional `EFFECT_REDIS_TEST_CA` supplies
  a CA file. Never mutate or clean deployment state in endpoint mode. Mutating tests
  need owned disposable fixtures and unique key prefixes; never FLUSH shared servers.
- Live CI runs on every push to main, without canceling earlier main runs. PRs run
  offline checks automatically; live tests require an authorized `/test live [engine]`
  comment or default-branch workflow dispatch with a PR number. Resolve and verify
  the immutable PR head SHA. Keep trusted authorization/reporting jobs separate from
  untrusted checkout/install/test jobs; no write tokens, deployment secrets or shared
  dependency-cache writes in PR test jobs. Unauthorized comments must not cancel runs.
  Report each engine independently and retain build/configuration/JUnit evidence.
- Run `pnpm test:protocol:fuzz` when protocol/byte ownership changes; CI also runs
  its built-artifact corpus under an external deadline. Keep its seed/replay evidence.
- Run `pnpm check` after meaningful changes. It covers format, lint, root/package
  typechecks, offline unit/controlled integration tests, and builds. Run `pnpm fixtures:check`
  to validate backend pins before live acquisition; never depend on ignored research. Report skipped
  checks and their reason.
- Use `pnpm verify` for the full regular sequence: `check`, `fixtures:check`,
  `test:protocol:fuzz`, then `test:live --runtime all`. It stops on failure and keeps builds ahead
  of live mounts. Docker, OpenSSL and explicitly prepared images are required.
  Artifact-consumer and research-free phase checks remain separate distribution gates.
- Shared engine scenarios live in `test/runners/conformance/`, with reviewed version-bound
  expectations and selection under `test/support/conformance/`. Keep them runtime-neutral
  and load dist entrypoints; copy every runtime dependency into the frozen Linux assets.
  The live runner owns a fresh run ID and validates every selected record before writing
  ignored `test/results/engine-conformance.json`. Missing, stale or failed cells must not
  become a passing aggregate. Keep older primary/module/topology regressions too.
- Preserve observed dialects and semantic differences. Use explicit deployment profiles
  for reviewed guards where ignored flags could misattribute replies (Garnet NOSCORES).
  Never infer option parity from COMMAND, fabricate missing metadata or emulate server
  guarantees. Scope Pub/Sub release receipts to the listeners captured before pruning;
  requests arriving during scope closure require their own pruning pass.
- Check emitted artifacts and package contents before a release. Never include
  ignored research, secrets, fixtures, or local runtime state in a published package.
- Update concise maintained documentation when behavior, configuration, commands,
  dependencies, or architecture change. Keep detailed documentation in ignored
  research; maintain only concise README and agent instructions in Git.
- Create a commit after each meaningful, self-contained change using Conventional
  Commits. Lefthook formats/lints staged code and validates messages; pre-push runs
  workspace lint, typecheck, and tests. Hooks supplement CI and do not replace it.

## Private documentation and phase reports

- User preference: keep detailed docs and all phase records in ignored `/research/`.
  Never commit or force-add them, or recreate a tracked root docs directory.
  Keep actual test inputs, reviewed command expectations and fixture pins under
  tracked `packages/effect-redis/test/fixtures/`. Store descriptive scenario catalogs,
  future command/backend/release inventories, phase ownership,
  pass/fail history and progress in ignored research, even if a validator could read
  them. Do not create tests merely to justify committing planning documents. Root/package READMEs and
  this agent guide remain concise tracked references.
- When present, read `research/docs/progress/README.md`, its backlog and prerequisite
  reports before a phase. `research/implementation/README.md` indexes the local plan;
  tracked test code and fixtures own executable assertions and environments. Research references are
  optional on a fresh clone: inspect actual code/tests/history and do not make
  builds, typechecks, default tests, CI or package contents depend on private files.
- Implement the authorized phase with behavior and tests. Preserve the broad v1
  target and verified prerequisites. A phase order does not authorize publication
  or paid provisioning.
- After every phase, write/update `research/docs/progress/reports/NN-topic.md` using
  `research/docs/progress/phase-report-template.md` when available. Checkpoint partial
  work before handoff; keep incomplete gates open. Update the local index/backlog.
- Reports record behavior/modules, exact commands/counts/results, real versus
  controlled fixtures, versions, cache freshness, failures/skips, decisions,
  deferred work and next actions. No credentials or real payloads. Missing live
  evidence is not a pass; every deferred promise needs an owner and closure criterion.
- Keep fixture validation, runtime source, tests and executable fixtures
  tracked and self-contained. Put future generated production metadata in its owning
  source module; generating it locally must not make normal builds require research.
- Keep AGENTS.md instructional. Store detailed architecture/protocol notes under
  `research/docs/architecture/` and history in local reports. No private-file
  dependency or broken research links in tracked/package READMEs.

## Architecture decisions

Local details, when present, live in `research/docs/architecture/foundation.md` and
`research/docs/architecture/protocol.md`. Before socket integration inspect actual
codec code/tests: drain results between feeds and partition chunks to remaining
retained-wire capacity. Codec Results compose through Effect.fromResult; protocol
errors retire a decoder and later its physical connection generation. Private research
command inventories are planning seeds, not production routing/replay metadata.

These are design decisions, not implemented features. Check installed APIs and
real-server conformance before making public compatibility promises.

### Native protocol and boundaries

- Implement RESP directly: ordered command tokens → binary RESP frames → scoped
  TCP/TLS socket → incremental reply decoder → typed command result. Do not wrap
  another Redis client or use textual inline commands.
- Keep protocol/value/byte codec modules pure and runtime-neutral. Build the
  connection scheduler above them, then the executor/client and category command
  modules. Runtime adapters supply Node/Bun sockets or Upstash HTTP. Dependencies
  point toward protocol; protocol must not import the client or runtime adapters.
- Use the installed `effect/socket/Socket` contract where it fits; Node net/tls or
  Bun.connect implement the platform boundary. Socket writer acquisition can wait
  across disconnects, so gate writes by a live connection generation and completed
  handshake. A reconnecting socket must not silently replay an old command.
  The Node adapter directly implements our physical Transport contract. It reads
  at most 64 KiB per pull in native readable mode and permits one pending reader
  and writer. Writes snapshot input, enforce maxInFlightBytes, and send 64 KiB
  chunks with callback/drain backpressure. Interruption of an active write destroys
  that socket; it never resumes the remaining bytes on another connection.
- The Bun adapter snapshots callback bytes, pauses native reads and bounds staging
  by bytes and callback count. Its staging budget has a 64 KiB floor independently
  of smaller protocol retention limits: a native chunk can contain many complete
  replies. ReplyReader partitions that chunk to decoder capacity and drains replies.
- Use `effect/http` HttpClient/FetchHttpClient for HTTP. Do not force stateless HTTP
  through the stateful TCP connection contract. Share command descriptors and codecs
  only when provider/transport semantics match.
- HTTP execution lives behind `/upstash`. Keep bearer credentials Redacted, redirects
  manual, request spans free of payload-bearing paths, buffers/concurrency bounded and
  fetch workers owned by both service Scope and caller cancellation. JSON-only batches
  preserve number lexemes and snapshot command-dependent response policies. Reject raw,
  custom and scripting transaction replies whose erased RESP types cannot be recovered.
  Reuse Effect's bounded Sse decoder; readiness requires provider acknowledgment and
  EOF/retry/overflow exposes a gap/failure without automatic replay or reconnection.
- HTTP ordinary/pipeline replies use RESP2; JSON-only transaction object keys and
  erased custom/script wire types require explicit rejection until a reviewed contract
  establishes lossless decoding. Reject binary request positions that JSON cannot
  represent and dot segments that URL parsing would normalize. SSE uses one validated
  text channel and a bounded backpressured handoff; it provides no binary fidelity claim.
  Keep `commands/upstash` separate from Redis `FT.*`/`V*` dialects.
- Local HTTP fixtures use the tracked digest-pinned Uprest profile with owned current
  Redis/Valkey servers. Include them in the existing live CI policy, never provision
  hosted infrastructure implicitly. `test:upstash` selects only HTTP cases;
  `dev:upstash` owns a generated 0600 connection file under ignored results, removes
  it on SIGINT/SIGTERM and never prints the token. Do not clear that directory through
  another runner while an interactive fixture uses it. Native TS fixture children
  need `--experimental-transform-types` for existing parameter-property declarations.
- Keep command families in separate modules/files (strings, hashes, lists, sets,
  sorted sets, streams, keys, Pub/Sub, scripting, administration, module families).
  Keep research catalogs split into category files under each backend's folder too.
  Do not make one catch-all file for every Redis command.

### Command and value contracts

- A raw command accepts a nonempty ordered sequence of `RedisArgument` tokens and
  returns a lossless RESP value. Split multiword commands into tokens: `CLIENT`,
  `LIST`. Unknown/custom/module commands need no library release or allowlist entry.
- Typed descriptors pair argument encoding with reviewed, option-aware reply
  decoding, key extraction, routing policy, capability notes, and replay policy.
  Avoid an unchecked generic `send<A>` that asserts arbitrary result types.
- Commands are Effects. Cursor scans and continuous consumption add lazy Stream
  helpers. Redis lists/sets/hashes/streams remain remote server state; Effect Queue,
  PubSub, collections, or Stream do not reproduce those server data structures.
- Bytes are `Uint8Array`; string encoding is explicit UTF-8. Calculate wire lengths
  from encoded bytes, preserve empty and invalid-UTF-8 blobs, and never auto-JSON
  serialize values. Application Schema codecs are optional explicit operations.
- Preserve all relevant RESP2/RESP3 types, nested errors, attributes, and pushes.
  Keep raw map keys/pairs lossless. Attributes decorate the following value; pushes
  and attributes do not consume ordinary command reply slots.
- Use bigint/preserved decimal tokens for exact integer replies; number conversion
  requires a safe-range check. Keep doubles/special floating values distinct.
  Missing values, empty strings, timeout nulls, and TTL negative sentinels differ.
- Parse incrementally across arbitrary chunk splits. Bound header/blob/buffer size,
  aggregate counts and nesting depth; reject invalid lengths/terminators without
  unbounded allocation or quadratic full-buffer concatenation. Retire a malformed
  connection. Treat streamed RESP3 aggregates and replication/RDB framing as explicit
  additional capabilities; ordinary RESP3 support does not imply them.

### Connection correctness and sessions

- One physical socket owns one ordered writer, one reader, and a bounded pending
  FIFO of Deferred results. Bound queued/in-flight command count and bytes; respect
  native write backpressure. Register pending slots before bytes can be sent.
- Coordinate admission, pending registration and writing so interruption cannot
  orphan/reorder replies. On close/failure, retire the connection generation and
  complete every waiter exactly once; stop admission and release scoped workers.
- Before write ownership, cancellation can remove an unsent command. Once it may
  have been written, retain a tombstone and drain its reply, or retire the socket.
  Removing an in-flight slot can deliver its reply to the wrong caller.
- A timeout/disconnect after write has an unknown execution outcome. Never replay
  mutations, scripts, destructive pops, XREADGROUP, or EXEC automatically. Connection
  retry, explicit server-rejection recovery and application retry are different
  policies. Read-only alone does not establish replay safety.
- Finish TLS, authentication, protocol negotiation, client naming and database
  selection before ordinary admission. Fall back from HELLO 3 only on a verified
  unsupported protocol/command response and permitted policy; do not turn auth,
  ACL, TLS, network or parse failures into successful fallback.
- Pipelines preserve order and individual failures but add no atomicity. Lease one
  connection for WATCH/read/MULTI/EXEC; distinguish null EXEC conflicts, queue-time
  aborts and individual runtime errors. Redis does not roll back sibling commands.
  Cleanup with UNWATCH/DISCARD when valid, or destroy the lease before reuse.
- Use dedicated scoped connections for blocking operations and subscriptions.
  WAIT/WAITAOF must stay with the writes they cover; an unrelated pool lease changes
  their semantics. ASKING, CLIENT CACHING and other next-command state also require
  exclusive scheduling on the correct socket.
- CLIENT REPLY OFF/SKIP, MONITOR, RESET/QUIT, SHUTDOWN and replication change response
  or connection behavior. Route them through explicit reviewed session/mode APIs.
  Unknown raw stateful commands require an explicit session/node; do not corrupt
  the shared request/reply scheduler to claim broad raw-command support.

Implemented ordinary-engine policy:

- `Connection.layer`/`makeConnection` capture the Transport and credential services.
  Credential Effects are reacquired per physical generation with that generation's
  Scope. Choose fixed configuration credentials or an Effect source, never both.
- `executeOrdinary` declares one ordinary reply and returns lossless RESP, including
  raw server errors. The typed executor converts top-level server errors to redacted
  ServerError; explicit raw execution preserves them. Known session/blocking
  controls are rejected; future/custom operations require reviewed caller semantics.
- Admission reserves encoded count/byte capacity before waiting for recovery. Full
  queues fail explicitly; accepted work has a whole-command deadline. Encoding
  measures against available capacity before allocation. Fast replies retain write
  ownership/budget until the local write finishes.
- Cancellation after possible write retires the whole generation; this implementation
  does not retain tombstones. Fail old queued work as unsent and written work as
  possibly-written. Reconnect lazily for new work only, after old cleanup completes.
  Preserve defects; cleanup failure must prevent replacement acquisition.
- Raw push buffering is bounded by count and retained wire bytes, generation-tagged
  and single-consumer. Attributes stay attached. Overflow retires the connection;
  phase 09 owns full subscription/gap semantics. Diagnostics must stay payload-free.

Implemented command-system policy:

- `Redis.layer` captures `CommandExecutor`, whose ordinary Layer captures `Connection`.
  Compose infrastructure outside command families. `makeRedis`/`makeExecutor` support
  explicit composition without opening additional sockets or starting runtimes.
- `Command<A, E, RD, RE>` prepares a `PreparedCommand` with declared key indexes,
  access roles, routing, mode, provenance and scenario IDs. Preparation requires RE;
  reply decoding requires RD. Execution combines both. Keep these requirements exact.
- `Commands` builders and facade methods share encoders/decoders. The reviewed family
  expectations in `test/fixtures/commands/` must match production metadata. Keep broad command
  coverage/progress inventories in research; active catalogs do not imply completeness.
  Use handwritten reviewed overlays until generation has a demonstrated repeated need.
- New ordinary collection operations preserve binary values and ordered pairs by
  default. Count/detail variants have separately named typed builders (lpopCount,
  zrangeWithScores, lcsMatches, geosearchWith); never assert an unchecked generic reply.
  Preserve per-field/key TTL negative sentinels. Long-double results use decimalToken,
  while score/scoreToken retain sorted-set IEEE-double semantics. Array indexes/cursors
  support uint64 and RESP2 decimal bulk/RESP3 big-number replies without Number coercion.
- Bind positional reply lengths and option-dependent decoders to validated preparation
  snapshots. A later caller mutation must not change the meaning of prepared wire flags.
  Preserve nested ReplyError paths and reject malformed completed replies without replay.
- SORT BY/GET indirect patterns use Routing.Dynamic with explicit primary/store keys
  plus unresolved patterns. Standalone execution is valid; future topology executors
  must resolve/review or reject this variant, never route only the primary key. COPY
  DB/MOVE/keyspace operations also need explicit topology policy before Cluster claims.
- Availability notes describe pinned source baselines, not automatic preflight gates.
  Older/alternative engines return typed server errors for unsupported commands/options;
  do not emulate them or equate absence in one engine with universal unsupported state.
- GET text is strict UTF-8 with BOM preservation; getBytes/raw preserve binary data.
  Missing blobs use Option, integer replies use bigint, and zscoreToken preserves
  decimal wire text. zscore explicitly converts to the server's IEEE double domain.
- SET returns void unconditionally, boolean with a condition, or previous-byte Option
  with GET. GET does not reveal whether the condition applied. Expiry is an exclusive,
  unit-tagged choice. Respect pinned version differences; no silent emulation.
- `RedisKey`/`PayloadCodec` select explicit Schema JSON or text encoding. Typed-key
  writes reject GET. Never infer arbitrary application types or auto-JSON raw values.
  Commands are lazy; prepared binary arguments are borrowed until connection admission
  snapshots them under its budget. Do not mutate prepared intent while executing it.
- Typed server errors, reply mismatches and payload errors remain distinct from wire
  failures. Server/payload causes are redacted. Decoder defects and interruption
  propagate; a completed reply followed by a codec failure does not justify replay.
- Ordinary raw calls declare routing/mode and retain lossless errors/attributes.
  Custom descriptors require actual decoders. Nonordinary modes and explicit-node
  routing are rejected by the standalone executor; known session guards still apply.
- Compile-only positive/negative API contracts live in test/types and are checked by
  the development typecheck. Vitest never executes them; keep this in aggregate CI.

Implemented native-session policy:

- `RedisSessions.layer(config, options)` provides `RedisSessions` plus `BatchExecutor`.
  Ordinary `Redis` composition stays valid; pipeline/transaction methods require the
  batch capability. Leased clients capture it. HTTP may later provide batches alone.
- Session and blocking sockets use separate lazy bounded lanes. Their limits exclude
  separately owned ordinary Connections. Bound waiters and lease acquisition; release
  permits through Effect finalizers even when acquisition, user code or cleanup fails.
- A lease stays on one physical generation. Sequential session use is required;
  concurrent/nested transaction use fails explicitly. Retained clients fail after
  scope exit. Clean known WATCH/MULTI state or retire uncertain state before reuse.
  Retire FIFO ownership before closing worker scopes. Physical cleanup defects poison
  the pool and prevent replacement acquisition; never swallow them to reopen capacity.
- Prepare whole batches before writes. Preserve readonly Result tuples and codec
  requirements. `BatchError.outcomes` is redacted: Completed has a decoded result,
  Replied retains an undecoded raw reply, Unsent/Unknown preserve indexed evidence.
  Interruption/defects remain in the Cause. Use the protected batch-error mapper;
  an interruptible recovery boundary can discard attached failure evidence in v4.
- Transactions distinguish Committed results, WATCH Conflict and queue/EXEC rejection.
  QUEUED proves queueing only. Individual EXEC failures do not roll back siblings;
  definitely unsent EXEC retains queue receipts as not-executed, while possible-write
  EXEC loss is unknown. Never replay uncertain EXEC. Cleanup failures propagate and
  prevent unsafe reuse.
- Blocking builders remain grouped with lists/sorted sets. Scoped blocking leases use
  explicit Duration waits or `"forever"`, an independent reply deadline and bounded
  socket-write deadlines. Server timeout is an absent value; reply loss after a pop
  can mean consumption. Do not replace server blocking semantics with polling.
- WAIT/WAITAOF are leased-client methods so acknowledgments stay with preceding writes.
  Return actual bigint counts, including shortfalls on server timeout. AOF/replica
  fixture acknowledgments do not prove hardware durability or strong consistency.
- CLIENT CACHING is paired with its command under one session operation. Advanced raw
  controls declare one reply and taint their lease for retirement; known reply/mode
  switches require reviewed APIs. Full tracking/invalidation semantics remain in09.
- Reply suppression admits OFF/SKIP, ordinary commands and ON as one fenced write with
  one expected reply. Individual outcomes are intentionally discarded; failed fences
  retain unknown mutation evidence. Compound encoding retains at most two wire budgets
  during fragment/output copying. RESET/QUIT retire; Valkey CAPA/IMPORT-SOURCE flags
  are isolated to their scope and retain actual server/version/configuration behavior.
- Session conformance lives in test/e2e/sessions; controlled lifecycle/fault cases in
  test/integration/sessions and type contracts in test/types. Replication/AOF fixtures
  own their Testcontainers network and both servers; no implicit image pulls/reuse.

Implemented scan/stream policy:

- Scan pages retain opaque decimal cursors; empty nonterminal pages and duplicates
  are valid. Lazy helpers do not imply snapshots or deduplication. ARSCAN is an
  ordered index range in either direction; UINT64_MAX is a reserved insertion cursor.
- Stream IDs stay exact; fields remain ordered binary pairs. Named result variants
  bind to prepared flags. Preserve legacy claim null entries without fabricated IDs,
  optional deleted-ID evidence and signed consumer timing sentinels. CLAIM delivery
  metadata counts previous deliveries; XPENDING counters have their own semantics.
- `RedisStreams.layer` captures Redis and RedisSessions. Continuous readers use scoped
  blocking leases and a one-entry handoff queue plus a decoded batch. Join producer
  cleanup so defects escape consumer termination. Resolve $ once; failures terminate
  the reader without automatic replay/reconnect. Validate recovery cursor progress.
- Processing uses the separate ordinary executor for acknowledgments. `consume` finishes
  own pending processing before new deliveries; explicit claim pages retain deletion
  evidence. Preserve exact handler/policy service requirements and typed failures.
- Acknowledge only after handler success or an explicit failure-policy decision.
  Tombstones, failed decoding and acknowledgment loss cannot trigger hidden ack/retry.
  Failure policies have bounded attempts and explicit Retry/LeavePending/Acknowledge
  outcomes. Dead-letter effects and XACK have no implicit atomicity or exactly-once claim.
- Stream payload fields are explicit codec envelopes. Snapshot wire options before
  user codec Effects; reject missing/duplicate/tombstoned fields without losing raw data.
  Keep all detailed coverage/version records and progress under ignored research.

Implemented scripting/administration policy:

- EVAL/FCALL builders require explicit keys and actual decoders. Preserve decoder
  requirements and derive numkeys/key indexes from the prepared arrays. Read-only
  variants retain server/version restrictions without fallback to writes.
- RedisScript.make uses Effect Crypto and redacts an owned source snapshot. Optional
  native cryptoLayer belongs behind /node; universal code never imports Node crypto.
  Managed source must not forge Redis's reserved canonical NOSCRIPT response.
- RedisScripts captures one backend's RedisSessions. Recover only a canonical server
  cache rejection, with one load and one retry on the same lease. Default load receipts
  are generation-bound; server-scope sharing requires explicit proven node affinity. Decode
  outside recovery. Propagate loader failure/cancellation to its waiters; never retry
  mutation errors, uncertain replies, application decoders or whole batches.
- Bound additional binary recovery snapshots before copying, after pool admission;
  queued callers borrow unchanged intent. Keep pending loads bounded and complete
  receipts on every exit. Cluster node-specific coordination belongs to its executor.
- RedisAdmin targets its configured native backend, never an implicit broadcast.
  Group client-local controls through withSession. AUTH/SELECT, HIMPORT fieldsets and
  exclusive descriptors retire their physical lease; HELLO without arguments only
  inspects the current protocol. Initial negotiation belongs to configuration.
- Inspect pinned code before accepting an inventory classification. Redis HIMPORT
  and BACKUP are public session/admin operations, distinct from private RDB transfer.
  HIMPORT SET replaces a hash with values in prepared field order. Backup lifecycle
  state and MIGRATE partial-transfer errors require explicit application decisions.
- Redact secret-bearing ACL/config/log/file-path responses. INFO keeps exact strings,
  duplicate/unknown fields and sections; open-ended replies retain lossless extensions.
- MONITOR owns a dedicated event socket, bounded single-consumer mailbox and explicit
  diagnostic line limit. Preserve redacted raw frames when parsing is uncertain;
  never log command text or silently drop/reconnect. Ordinary header limits stay intact.
- SHUTDOWN EOF reports an observed close with unknown execution. ABORT requires OK.
  Bound shutdown and abort separately so abort can cancel a pending shutdown. Keep
  cleanup defects visible and poison implicit replacement; never replay controls.
- Keep private replication/stream-repair, protected debug, interactive SCRIPT DEBUG
  and source-unverified newer catalog records as explicit boundaries. Encoding them
  or observing server rejection is not proof that the advanced protocol is implemented.

### Streams, subscriptions and recovery

Implemented subscription/tracking policy:

- `RedisPubSub.layer(config, options)` owns a dedicated event connection. Reuse
  Transport/handshake/codec boundaries; never put subscription acknowledgments into
  ordinary FIFO slots. Acquisition waits for ACKs, and duplicate local interests
  share server ownership. Channel/pattern/shard modes remain distinct.
- Bound event count/bytes and active/retiring listeners. Reader dispatch never waits
  for application Effects. Manual close releases the listener's child Scope; failed
  ownership is pruned with reserved bounded cleanup admission. Preserve cleanup poison.
- Default disconnect fails. Opt-in resubscribe exposes DeliveryGap/Ready events;
  the message-only view fails on gaps. Never replay PUBLISH/SPUBLISH. Foreground
  admission pressure defers heartbeat rather than declaring a dead socket.
- `RedisTracking` owns one data connection plus a redirected receiver when needed.
  Critical invalidation precedes observer delivery; observer overflow cannot block
  eviction. Receiver/data loss clears the whole cohort. Restart is explicit and
  waits for cleanup/rebinding. Future rejected calls are unsent.
- `RedisCache` caches only GET bytes and decodes each RedisKey codec anew. Isolate
  backend/DB identities, preserve binary keys and bound entries/bytes/loads/TTL.
  Reject stale insertion after invalidation; clear on gaps/flush/restart and handle
  local writes/NOLOOP explicitly. Do not add arbitrary command-result caching without
  a reviewed invalidation contract. Shard commands do not establish Cluster routing.

- One-shot XREAD/XREADGROUP returns an Effect; a continuous reader is a scoped
  Stream. Preserve exact stream IDs, ordered fields, tombstones and option-dependent
  tuples. Resolve `$` once when establishing a continuous reader, not on each poll.
- Consumer groups expose pending recovery, claim/autoclaim, explicit acknowledgments
  and retention/deletion policies. Processing helpers acknowledge after application
  success. Cancellation can cause redelivery; do not promise exactly-once processing.
- Cursor helpers use Stream pagination without treating an empty nonterminal page
  as completion. Keep cursors opaque and document duplicates/no snapshot guarantee.
- Pub/Sub is at-most-once. Track subscription acknowledgments and pattern/sharded
  modes; separate control frames, invalidations and unknown pushes from ordinary
  replies. Local PubSub/Queue fanout is bounded. Slow subscribers must not block the
  shared reply reader. Overflow/reconnect must fail or expose an explicit delivery
  gap; never silently drop messages or imply reconnect recovered missed events.

Implemented Sentinel policy:

- `RedisSentinel.layer` provides RedisSentinel, Redis, CommandExecutor and BatchExecutor.
  Reuse native leases, FIFO, blocking, script, stream and event implementations; keep
  discovery/generation code runtime-neutral. Sentinel control endpoints and data-node
  configuration, credential sources and TLS identities remain separate.
- Query a bounded Sentinel set, verify the primary's ROLE, and re-resolve before every
  physical data open. Capture the internal role policy in ordinary/session/event owners
  so lazy acquisition cannot lose it. Default reads target the primary; explicit eligible
  replica reads may be stale. Sessions, scans, scripts and stream consumers stay primary.
- Discovery workers belong to the client Scope, independently of individual waiters.
  Bound deadlines, attempts, waiters, pools and event cohorts. Learn peers only when
  enabled and within the endpoint bound. Polling and physical-open queries are the
  implemented strategy; notifications are not required for correctness.
- Acquisition can follow a replacement only before invoking the user's callback.
  Never repeat started callbacks, application commands, uncertain mutations or EXEC.
  Preserve native delivery/indexed evidence and keep application decoding outside
  recovery. Pool pressure and deliberate successful socket retirement do not invalidate
  a healthy deployment generation. Cleanup defects poison replacement acquisition.
- Leases and cursor streams remain bound to their starting generation. Close old event
  cohorts and clear caches before publishing replacement routing; retained views fail
  and callers explicitly reacquire. Control requests are owned by client close, use
  explicit configured endpoint indexes and never retry mutations automatically.
- ROLE verification does not fence a partitioned old primary or prevent asynchronous
  replication data loss. Do not promise strong consistency, zero data loss or complete
  hosted/secondary Sentinel certification. Real tests own three data nodes and three
  Sentinels; partition tests cut established peer links without hiding inspection access.

### Topology and capability policy

Implemented Cluster policy:

- `RedisCluster.layer` provides RedisCluster, Redis, CommandExecutor and BatchExecutor;
  `makeRedisCluster` captures Transport and credential services. Reuse native lease/FIFO
  machinery. Keep Cluster routing free of Node globals and runtime dependencies.
- Hash exact key bytes with CRC16-XMODEM and first-brace hash tags. Validate all known
  keys before writes; global pipelines/transactions require one slot. Explicit node
  pipelines can span that node's slots; transactions and WATCH remain single-slot.
  Optional session validation covers prepared calls, batches, WATCH, caching prefixes,
  reply suppression and database controls. Never silently move an active lease.
- Publish only complete, nonoverlapping SHARDS/SLOTS maps. Bound nodes, retiring pools,
  operations, retained intent bytes, refresh owners and event cohorts. Coalesce refresh;
  own periodic refresh in the client Scope and record failures while retaining the last
  valid snapshot. ACL/auth/protocol errors cannot authorize a discovery fallback.
- Follow bounded MOVED/ASK rejections only before decoding; ASKING and the command own
  one exclusive lease. Failed wire work is never replayed. Mark discovery stale for new
  work after connection/CLUSTERDOWN/READONLY failures. Preserve indexed EXEC uncertainty.
  Failed physical cleanup poisons replacement acquisition across the registry.
- Snapshot binary retry intent using `new Uint8Array(value)`: Buffer.slice borrows memory.
  Measure against retained budgets before copying. Blocking `forever` keeps an explicit
  scoped reply lifetime; discovery/admission/writes retain separate bounded policies.
- Translate announced addresses at the dial boundary; retain announced TLS identity
  unless explicitly mapped. Redis uses DB0; configured Valkey multi-DB requires an
  explicit capability and real `cluster-databases` fixture configuration. Keep a client's
  database identity fixed across leases, tracking and cache scopes.
- Replica reads are explicit and potentially stale. Use READONLY/READWRITE on exclusive
  leases; exclude unsuitable/keyless/script operations from automatic replica routing.
  Keyless keyspace/admin calls require explicit nodes. onPrimaries is a lazy sequential
  Stream of per-node Results, with no global atomicity or implicit replay.
- Managed Cluster scripts load on the rejected node/physical lease; include node identity
  in shared receipts. After ASK/NOSCRIPT/loading, re-arm ASKING before retrying. Application
  decoders run outside recovery. Lua must not forge reserved cache/routing rejections.
- Global scans traverse distinct primaries and check topology at every page, including
  empty terminal pages. CLUSTERSCAN cursors are opaque NOT_KEY routing tokens: even
  initial "0" hashes as its actual bytes; SLOT selects the following tagged cursor.
- Topology changes/redirects clear old tracking/cache cohorts before publishing routes.
  Old subscriptions fail visibly; reacquire on the new owner. Opt-in reconnect within
  one node retains DeliveryGap/Ready semantics. Never imply recovery of missed messages.
  Fork cohorts from their caller Scope so retirement unlinks parent finalizers. Observe
  topology before choosing an owner; failed acquisition releases cohort capacity. Closing
  the client stops event admission and attempts every cohort cleanup before propagating defects.
- Keep cluster tests under test/unit/cluster, integration/cluster and e2e/cluster. Owned
  six-node fixtures use pinned images; partition fixtures route inter-server data and
  bus links through an owned bounded native Node proxy. A Docker network detach alone
  does not prove established links were cut. Preserve main/manual-PR CI trust policy.
- Public CLUSTER MIGRATION and TRIMSLOTS supersede old internal inventory labels;
  CLUSTER SYNCSLOTS remains a guarded replication-channel protocol. Stock Redis8.10.2
  generation excludes experimental SFLUSH; record actual absence, not positive support.

- Standalone, Cluster, Sentinel, explicit-node and HTTP are separate execution
  modes with shared contracts where appropriate. Support for encoding a command
  does not mean every backend/transport implements it.
- Cluster hashes binary keys with CRC16-XMODEM and Redis hash-tag rules. Bound
  MOVED/ASK redirects, refresh topology, and pair ASKING immediately with its target
  command. Preserve multi-key atomicity: reject cross-slot operations unless a
  separately named scatter/gather helper explicitly changes their guarantees.
- Generate key extraction only from reviewed metadata. Handle incomplete/movable
  keys and commands such as EVAL/FCALL/XREADGROUP/SORT with explicit rules. Unknown
  raw commands require declared keys or a target node; argument one is not always
  a key. Administrative commands need explicit per-node/broadcast semantics.
- Redis Cluster permits database 0 only; Valkey 9+ can enable multiple databases
  through configuration. Model this as a backend capability, not a universal rule.
  Sentinel uses separate endpoints/credentials and primary discovery plus ROLE
  verification; refresh on failover without replaying uncertain writes.
- Use supported/unsupported/unknown capabilities with recorded evidence. COMMAND
  INFO/DOCS, HELLO, MODULE LIST and INFO may be unavailable under ACL/provider rules.
  Unknown is not unsupported; server banners alone are not reliable feature tests.
- Track command/option availability separately from semantic parity. An accepted
  command can differ in atomicity, ordering, consistency or durability. Preserve
  documented differences in compatibility reports; do not silently rewrite commands
  into an allegedly equivalent sequence. Unknown evidence must not block arbitrary
  raw/module commands through a stale provider-wide allowlist.
- Treat engine, version, runtime, transport, topology, authentication and enabled
  modules as independent compatibility dimensions. Reuse the protocol core across
  Redis, Valkey and other RESP engines. Hosted services usually need profiles and
  configuration, not another client implementation; add adapters for mechanisms
  that actually differ, such as an HTTP command API.
- Support Effect-based credential acquisition/refresh at the connection boundary,
  in addition to fixed credentials. Capture redacted credentials and optional
  expiry, refresh for new/re-established connections, and coordinate reauthentication
  with exclusive sessions. Cloud identity SDKs must not become core dependencies;
  callers can supply credentials from their existing identity system.

Implemented ready-Layer identity/profile policy:

- `RedisCredentials.provider` is a pure declaration. Each consuming Layer owns one
  coordinator, captures source services, coalesces bounded acquisition and caches
  only validated expiring values. The source's temporary resources close after
  acquisition; cached values must not depend on those resources. Defaults are a
  60s refresh margin, 5s acquisition timeout and 128 waiters. Preserve defects and
  interruption; expected source failures are redacted typed errors.
- Native `credentialLifetime` is explicit: reconnect, token-expiry or max-age.
  Effective refresh acceptance covers the retirement margin. Never inject AUTH
  into a transaction, blocking lease or subscription. Retirement preserves unknown
  outcomes; new work alone reconnects. Cleanup failures poison replacement ownership.
  Chunk distant absolute deadlines to avoid native timer overflow.
- `RedisCredentials.rotate` invalidates and joins current acquisition, then retires
  owned sockets or aborts current HTTP workers. Sentinel control uses a separate
  `RedisSentinelCredentials` service/cache and `sentinelCredentials` input. A control
  rotation must not retire data sockets. Keep physical acquisition planes explicit.
- Provider profiles select actual routing/auth/TLS/database/restriction/module policy,
  with reviewed sources and pending certification. AWS IAM socket age differs from
  token expiry; Google IAM keeps existing authentication; Entra retires three minutes
  before expiry. Unknown availability is server-owned, never guessed unsupported.
  Keep known restrictions enforced in ordinary, batch and event wire paths.
- Check exact host and TLS-name allowlists after topology translation and before
  socket/credential acquisition. IAM/Entra topology profiles require explicit network
  trust. Hostname allowlists do not replace DNS/IP controls or CA/SNI verification.
  HTTP redirects stay disabled; source tokens never enter URLs or default diagnostics.

### Upstash and Bun

- Bun.RedisClient is another client, not a Redis server. Bun compatibility means
  this client's own transport runs on Bun; do not delegate to its built-in client.
- Upstash TCP/TLS can use RESP. Its HTTP executor uses native fetch through Effect,
  bearer headers, JSON token arrays, `/pipeline`, and `/multi-exec` as applicable.
  HTTP atomic batches do not provide a long-lived WATCH transaction session.
- Upstash REST documents no WATCH/UNWATCH/DISCARD, blocking list/sorted-set/stream
  reads, arbitrary connection controls, or client-side Cluster mode. Reject these
  capabilities explicitly. Do not impersonate blocking commands with polling.
- Upstash documents SUBSCRIBE/MONITOR over SSE; implement them as separate scoped
  HTTP streams with their own parsing and verified capabilities. Do not infer all
  TCP subscription modes from those endpoints.
- JSON arrays cannot express arbitrary binary arguments. Use only documented input
  encodings or fail explicitly. Evaluate RESP2 binary response mode for exact bytes
  and integers; base64 JSON strings do not solve JSON number precision. Test each
  command/batch endpoint before claiming a lossless shared codec path.
- Keep Upstash SEARCH.* and VECTOR.* descriptors separate from Redis FT.* and V*.
  Do not silently translate incompatible query/vector dialects.
- Effect 4.0.6 already has `effect/persistence/Redis`, an operations service rather
  than a native protocol implementation. Add an optional integration adapter later;
  its string-oriented API and buffering choices must not constrain our core model.

### V1 coverage target

The user prioritizes broad production coverage over an early release. These are
planned release targets, not implemented or certified support. Internal milestones
must not silently defer them to v1.1 merely to ship sooner.

- Target Redis and Valkey as primary command baselines, plus tested backend profiles
  for Dragonfly, KeyDB, Redict, Garnet and Apache Kvrocks. Preserve each backend's
  actual supported subset and semantic differences; do not invent missing features.
- Target named configurations of Redis Cloud/Software, AWS ElastiCache and MemoryDB,
  Google Memorystore Redis/Valkey, Azure Managed Redis, Upstash, Aiven Valkey,
  DigitalOcean Valkey and Alibaba Tair. Certify exact products/versions/configurations;
  a successful local engine test is not provider certification.
- Include Cluster, Sentinel, provider-routed endpoints, Upstash HTTP/SSE, Node/Bun
  native runtimes and tested HTTP execution on Deno/Cloudflare Workers in v1 planning.
  HTTP support does not imply native TCP support on every runtime.
- Include typed public application-command families for declared Redis/Valkey
  baselines, sessions, Streams/PubSub, scripting/functions and selected versioned
  JSON/search/time-series/probabilistic/vector module families. Retain raw/custom
  descriptors for other extensions and explicit boundaries for advanced wire modes.
- Require scenario-level conformance, fault/recovery tests, bounded-resource soaks
  and real provider tests before advertising a configuration as supported. Record
  missing tests as pending. Do not claim an 80–90% market share without evidence or
  accept an aggregate pass percentage in place of passing every promised capability.

### Implementation milestones and verification

The list below groups responsibilities. The local research progress index owns the twenty
phase IDs, prerequisites and status; these groups are not alternate phase numbers.

1. Binary RESP codec and limits, with fragmented/malformed input fixtures.
2. Scoped Node TCP/TLS, handshake, raw commands, typed errors, bounded scheduling,
   cancellation and unknown-outcome handling.
3. Reviewed typed command families and metadata generation with semantic overlays;
   test option-dependent arguments/replies and track coverage explicitly.
4. Pipelines, sessions, transactions, blocking operations, Pub/Sub and Stream/group
   recovery against disposable real Redis and Valkey instances.
5. Cluster redirects/resharding, Sentinel failover, Bun transport, Upstash HTTP/SSE,
   module/dialect extensions and any claimed replication modes.
6. Packed consumer/declaration checks and benchmarks before publishing.

Test cancellation before/after write, interleaved pushes/attributes, partial writes,
disconnect during mutations/EXEC, socket/listener/fiber cleanup, binary round-trips,
integer fidelity, wrong types, TLS/auth/ACL failure, and server/option differences.
Keep live provider tests opt-in. Record server/runtime/transport/protocol/module
versions for compatibility claims; a metadata inventory is not conformance.

Research baseline: Redis 8.10.2 and Valkey 9.1.2 source metadata plus a pinned current
Redis docs catalog and Upstash references, investigated 2026-10-25. Counts include
containers, subcommands, internal commands and modules, so no universal command
total is promised. Sources remain accessible without ignored research:

- [RESP specification](https://redis.io/docs/latest/develop/reference/protocol-spec/)
- [Redis 8.10.2 commands](https://github.com/redis/redis/tree/8.10.2/src/commands)
- [Valkey 9.1.2 commands](https://github.com/valkey-io/valkey/tree/9.1.2/src/commands)
- [Redis Cluster](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [Valkey Cluster](https://valkey.io/topics/cluster-spec/)
- [Sentinel client specification](https://redis.io/docs/latest/develop/reference/sentinel-clients/)
- [Upstash REST](https://upstash.com/docs/redis/features/restapi)
- [Upstash compatibility](https://upstash.com/docs/redis/overall/compatibility)
- [Garnet semantic compatibility](https://microsoft.github.io/garnet/docs/welcome/compatibility)
- [Cloud credential refresh example](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth-iam.html)

### Module command conventions

- Module versions are independent of server banners. Keep actual module receipts and
  startup profiles under test/fixtures/modules; normal transport fixtures do not load
  optional modules. Unknown module/options remain typed server errors, never emulated.
- JSON modern/legacy and expanded RESP3 formats have explicit contracts. Numeric
  mutations preserve decimal tokens, including Redis RESP3 legacy arrays. Valkey
  dialect differences need actual pinned conformance, not inferred Redis behavior.
- Vector FP32 byte order is explicit and must match the server's native float layout.
  Keep quantized VEMB RAW bytes/norm/range and score/attribute reply variants distinct.
- TimeSeries timestamps, retention and buckets use milliseconds; retain bigint times,
  floating/NaN values, binary labels and multi-aggregation columns. Label queries are
  server-owned state and need an explicit Cluster node. TS.READ blocking uses native
  scoped leases; BLOCK zero means no wait, so never encode forever as zero.

- Search index names are server-owned identifiers, not Redis keys. Use Keyless
  metadata for index/global operations and explicit Cluster nodes; suggestion
  dictionaries are real keys. Bind search reply widths to prepared flags, retain
  protocol-specific metadata/counts and keep HYBRID's envelope separate.
- Search cursors own one native lease through cleanup. Protect bounded page receipt
  acquisition and cursor-ID assignment from interruption, then restore cancellation
  for row handoff and empty pages. Never replay uncertain reads. Unknown IDs expire
  under the configured MAXIDLE; deletion failures must escape cleanup.

- SCANDUMP chunks describe physical filter layout: keep BF/CF dump reads on primaries
  under Cluster/Sentinel replica preferences. CF.COMPACT also remains primary-bound
  despite the server's readonly flag. Bloom INFO selectors normalize only their
  reviewed scalar/one-element/one-field wrappers.
- Index/prefix hash-tag requirements vary by module/version; preserve server errors
  and use actual module Cluster fixtures. FT._LIST WITHCLUSTERSTATE has a separate
  structured builder. FT.CURSOR GC is a real public operation even without docs
  metadata; its signed no-collection sentinel must remain visible.

- BF.LOAD is a public Valkey Bloom operation, absent from the pinned RedisBloom
  builds. Its bytes are opaque versioned module serialization, separate from Redis
  DUMP and SCANDUMP. Verify loading with actual module AOF output. Valkey Bloom's
  VALIDATESCALETO belongs to BF.INSERT; SEED/TIGHTENING mutation flags are documented
  upstream as replication internals and have no invented application wrappers.
