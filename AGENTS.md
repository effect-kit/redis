# Effect Redis agent guide

## Scope and status

Build a native Redis-compatible client with Effect v4. This repository currently
contains a bounded RESP codec, validated configuration, value/transport contracts,
offline tests and tracked release specifications, not a networked Redis client.
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
  presets. Build libraries with tsdown and `klarity/tsdown/library`; keep
  TypeScript 7 for typechecking. Commit `pnpm-lock.yaml`; use `pnpm install --frozen-lockfile` in CI.
- Keep tsdown at **0.23.1** while using TypeScript **7.0.2**. Its declaration plugin
  supports this compiler; tsdown 0.23.2's plugin requires the TypeScript 7.1 API.
  Recheck the pair before upgrades; do not downgrade to TypeScript 6 or force isolated
  declarations just to bypass an incompatible declaration emitter.
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
  catalog pins @effect/vitest 4.0.6, Vitest 5.0.5 and Vite 8.3.5. Inspect exact
  installed APIs: v4 `it.effect` and `it.live` already provide Scope. Use TestClock for deterministic policy/race tests, live services for
  real sockets/processes/providers, and shared Layers only with explicit isolation.
  Keep typed fixtures/support modules reusable and focused; do not build a fake Redis
  implementation or use broad mocks that bypass the production scheduler. Typecheck
  tests/tools separately. Do not test placeholder exports or merely Effect itself.
- Run `pnpm test:protocol:fuzz` when protocol/byte ownership changes; CI also runs
  its built-artifact corpus under an external deadline. Keep its seed/replay evidence.
- Run `pnpm check` after meaningful changes. It covers format, lint, root/package
  typechecks, offline Effect Vitest/specification tests, and builds. Run `pnpm check:spec`
  for the tracked release inventory; never depend on ignored research. Report skipped
  checks and their reason.
- Check emitted artifacts and package contents before a release. Never include
  ignored research, secrets, fixtures, or local runtime state in a published package.
- Update concise maintained documentation when behavior, configuration, commands,
  dependencies, or architecture change. Research is local evidence, not required docs.
- Create a commit after each meaningful, self-contained change using Conventional
  Commits. Lefthook formats/lints staged code and validates messages; pre-push runs
  workspace lint, typecheck, and tests. Hooks supplement CI and do not replace it.

## Phase progress and reporting

- Read [implementation progress](docs/progress/README.md), the
  [backlog](docs/progress/backlog.md), prerequisite phase reports and relevant actual
  code before starting a phase. The tracked index owns phase IDs/status and minimum
  gates; ignored local research can add detail but is not a build/test dependency.
  When available, `research/implementation/README.md` indexes the detailed local plan.
- Implement the authorized phase with behavior, tests and docs together. Verify its
  prerequisites; do not restart completed work or silently narrow the broad v1 scope.
  Internal phase order does not authorize external publication or paid provisioning.
- After every phase, write/update `docs/progress/reports/NN-topic.md` using the
  [phase report template](docs/progress/phase-report-template.md). Also checkpoint
  partial/blocked work before handoff/interruption; keep status incomplete until
  its acceptance gates actually pass.
- Reports record delivered behavior/modules, exact check commands/results/counts,
  real versus controlled fixtures and versions, fresh versus cached evidence,
  decisions, failures/skips, deferred/backlog IDs and exact next actions. No secrets
  or unredacted traffic. A report or zero-test job is not implementation evidence.
- Update the status index and backlog in the same coherent commit. Every deferred
  promised item needs an owning phase, release impact and measurable closure criterion.
  Keep future scope distinct from release blockers; never hide a missing provider
  fixture or quarantine behind an aggregate pass percentage.
- Keep AGENTS.md instructional; phase history belongs in reports. Promote durable
  API/architecture decisions to owning maintained docs/code when implemented. Research
  stays ignored; do not force-add roadmap files or make maintained docs require them.

## Architecture decisions

Implemented contracts are documented in [foundation contracts](docs/architecture/foundation.md)
and [RESP codec](docs/architecture/protocol.md). Read the codec byte/EOF/ownership
contract before integrating native sockets. Drain results between feeds and partition
chunks to fit remaining retained-wire capacity. Codec Results compose through
Effect.fromResult; parser errors retire a decoder and later its physical generation.
The tracked [specification inventory](spec/README.md) owns release/fixture/scenario
inputs; its command modes are planning seeds, not production routing metadata.

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
- Use `effect/http` HttpClient/FetchHttpClient for HTTP. Do not force stateless HTTP
  through the stateful TCP connection contract. Share command descriptors and codecs
  only when provider/transport semantics match.
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

### Streams, subscriptions and recovery

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

### Topology and capability policy

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

The list below groups responsibilities. The tracked progress index owns the twenty
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
