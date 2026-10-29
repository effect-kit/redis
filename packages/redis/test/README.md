# Tests

All package test code, inputs and runners live here. Detailed design notes,
descriptive scenario catalogs and progress records belong in ignored research.
No test or runner requires that directory, and none of these files is published.

| Folder                                             | Responsibility                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `unit/`                                            | Focused codec, config, command, fixture-validation and tooling behavior               |
| `integration/commands/`, `integration/connection/` | Real component composition with controlled bytes and time                             |
| `integration/transport/node/`                      | Native TCP/TLS, socket faults and lifecycle                                           |
| `integration/backends/`                            | Real-server transport, connection recovery and fixture lifecycle                      |
| `e2e/`                                             | Public client command behavior and built/runtime or endpoint smoke checks             |
| `fixtures/`                                        | Independent wire/command expectations and pinned backend/image inputs                 |
| `support/`                                         | Scoped servers, mechanical transports, certificates and other reusable infrastructure |
| `runners/`                                         | CLI entrypoints, bounded fuzz worker and container runtime probes                     |
| `types/`                                           | Compile-only inference and expected-error contracts                                   |

Docker is an execution requirement, not a test category. Use unit tests for focused
components, integration tests for composition/platform boundaries, and e2e tests for
the public client against an actual backend. Keep fixture inputs separate from the
support code that acquires and cleans up resources.

Run from the workspace root:

- `pnpm verify`: offline checks, fixture validation, fuzz and every live suite, stopping on failure.
- `pnpm test`: offline unit and controlled integration suites via `vitest.config.ts`.
- `pnpm --filter @effect-kit/redis test:unit`: unit suite only.
- `pnpm fixtures:check`: validate image pins, target versions and module profiles.
- `pnpm fixtures:pull --engine valkey`: explicitly prepare pinned images.
- `pnpm test:live`: native/backend integration and e2e via `vitest.live.config.ts`.
- `pnpm test:live --engine valkey`: select the engine's applicable live cases.
- `pnpm test:bun --engine valkey`: run the selected backend through actual Bun processes.
- `pnpm test:upstash`: HTTP fetch faults, Redis/Valkey proxy cases and built Node/Bun consumers.
- `pnpm dev:upstash --engine redis --runtime all`: validate both consumers and retain an interactive fixture.
- `pnpm test:live --runtime node|bun|all`: select the runtime independently of the engine.
- `pnpm test:protocol:fuzz`: public-copying and private-owned built codec corpora in workers with external deadlines.
- `pnpm typecheck`: includes `types/`; Vitest never executes those contracts.

Both Vitest configs keep the package root explicit, disable env-file loading and
fail on empty selections. The offline config never selects native/server suites,
even when live-mode environment variables are present. Live tests need Docker and
OpenSSL plus prepared images; no automatic downloads or container reuse. Engine
versions, architectures and actual modules come from `fixtures/backends/` and are
validated before image preparation/acquisition. Expected command metadata is reviewed
separately in `fixtures/commands/` and checked against production descriptors.

Bun scenarios load compiled entrypoints in bounded, awaited child processes.
`integration/transport/bun` owns native socket/TLS/fault cases; `e2e/runtime/bun`
owns real application/module/topology scenarios and pinned Linux Unix probes.
Fixture metadata and `.bun-version` must agree before acquisition. Explicit binary
and endpoint modes default to Node and accept `--runtime bun|all`; endpoint probes
send only connection AUTH and read-only PING/ECHO in either runtime.

Module cases use `fixtures/modules/images.json` for digest-pinned Redis/Valkey module
profiles with explicit load paths and exact module-version receipts. `fixtures:check`
validates these before acquisition; `fixtures:pull` prepares the selected engine's
module images too. Module versions are independent of server versions and can use
different numeric encodings. Tests compare the actual receipts without guessing them.

Ordinary command contracts are grouped under `unit/commands/core/`; `integration/commands/`
checks executor composition and preparation snapshots. `e2e/commands/` uses the public
client against seven pinned Redis/Valkey builds in RESP2/3, with an independent socket
for selected state observations. Newer commands have explicit availability/error cases
on older builds. This is separate from the other engines' transport/state smoke tests.

`integration/sessions/`, `integration/streams/` and `integration/subscriptions/` prove
scoped ownership, controlled faults and deterministic policy behavior. Their `e2e/`
counterparts use real backends. Subscription tests include acknowledgment/readiness,
shared interests, gaps, tracking modes, cache invalidation and byte/codec identity;
proxy faults prove restart and publication uncertainty without automatic replay.

`integration/scripting/`, `integration/admin/` and `integration/diagnostics/` cover
load coordination, mode isolation, cancellation and cleanup with mechanical bytes.
Their real-backend `e2e/` suites verify script/function lifecycle and interruption,
ACL/configuration, migration between two owned servers, public HIMPORT/BACKUP and
MONITOR/SHUTDOWN. Destructive cases own their servers. Positive backup/module/topology
availability is distinguished from expected rejections on restricted/older fixtures.

`unit/cluster/` and `integration/cluster/` cover binary slots, discovery, redirects,
bounded ownership, script recovery, indexed EXEC loss and cleanup defects. `e2e/cluster/`
owns six-node Redis/Valkey clusters, with reshard/promotion, translated TLS identities,
replica reads, explicit Valkey multi-DB and topology-bound events/caches. Network
partition cases use `fixtures/networking/peer-proxy.mjs` in the existing pinned Node image
to cut established inter-server data/bus links while preserving inspection access.
All containers, networks and proxy resources have awaited cleanup; no images are pulled
implicitly. These suites join the existing main/manual-PR live lanes.

`unit/sentinel/` and `integration/sentinel/` cover configuration, discovery deadlines,
credential capture, generation ownership, cancellation, pressure and cleanup defects.
`e2e/sentinel/` owns three data nodes and three Sentinels. Discovery/control workflows
span all seven Redis/Valkey baselines in RESP2/3; current builds add actual promotion,
established-link partitions, unknown INCR/EXEC outcomes, replica selection, separate
authentication and mTLS. The shared peer proxy supplies the network fault boundary.
These tests demonstrate client failover behavior; ROLE alone cannot fence an isolated
old primary or prevent asynchronous replication loss.

The live runner also supports `--mode binary --engine redis|valkey --binary /absolute/path`
for an owned local process. `--mode endpoint` requires `EFFECT_REDIS_TEST_URL` and
only authenticates and sends read-only PING/ECHO; optional `EFFECT_REDIS_TEST_CA`
supplies a CA file. These smoke checks do not certify a deployment's command support.
Mutating cases use disposable fixtures and unique prefixes, never shared-server FLUSH.

`unit/upstash/` owns response/extension contracts; `integration/upstash/` composes
the real executor with controlled HTTP/SSE boundaries. `integration/http/` tests
actual fetch cancellation, redirects, size limits and untrusted TLS identities.
`e2e/upstash/` uses disposable current Redis/Valkey servers plus Uprest 0.5.0,
with pins under `fixtures/upstash/`. Fault relays lose actual committed responses;
independent native reads establish mutation/EXEC/group-delivery outcomes. Node/Bun
children load built HTTP exports. The dev-command test checks credentials-file
permissions and SIGTERM cleanup. None of these establishes hosted Upstash parity.

HTTP cases join `test:live` and the existing main/manual-PR CI policy for Redis,
Valkey and `all`; `core` includes fetch faults. `test:upstash` selects only these
cases, with the same `--engine` and `--runtime` filters. Endpoint/binary modes stay
native smoke checks. The interactive command writes a generated bearer token into
an owned 0600 file under ignored `results/`; it removes that file and its containers
on SIGINT/SIGTERM. Do not run another live runner against the same results directory.

Live JUnit/JSON and fixture evidence go to ignored `results/`, collected by CI.
Live checks run only through manual dispatch; PR live runs require authorized manual
selection. Keep that authorization controller under root `.github/`, separate from
untrusted package code. See the workspace README for CI triggers and backend scope.

`runners/artifacts/` checks three independent clean builds, every archive entry and
portable import graphs, then compiles/runs `fixtures/distribution/` from the exact
packed archive in isolated consumers. Run `pnpm test:artifacts` before live mounts.
The manual **Extended tests** workflow runs this suite with fixture validation and
protocol fuzzing; ordinary PR/main CI only runs the fast `ci:check` gate.

The release lane uses `pnpm release:pack` and `pnpm release:check` from the workspace
root. It checks the Changesets publish plan and exact archive, compiles the public
README examples, installs the archive in a fresh npm consumer, and executes offline Node/Bun
import probes. `pnpm release:smoke` performs the same checks after downloading the
published registry archive and matching its integrity. Neither verification command
publishes. Use `--provenance` to require provenance metadata in the registry
receipt. See the root release guide for the versioning workflow.

The root release check/smoke scripts include `--skip-live`: they still install
the exact tarball in a fresh consumer and checks types, README examples, Node/Bun
imports and integrity, but need no Docker or live backend. The underlying package
`test:release` and `test:release:registry` commands retain live checks unless given
`--skip-live`; prepare Redis/Valkey images before using them. Full conformance remains separately dispatchable.
Publication does not wait for npm registry availability. Run registry smoke checks
separately once the version is available, using the original verified archive and
`publish-plan.json` through `--pack-dir`, with `--provenance --skip-live` as needed.

`runners/benchmarks/` compares the built Node client with development-only ioredis,
node-redis and Valkey GLIDE against owned, digest-pinned Redis/Valkey fixtures:

```sh
pnpm fixtures:pull --engine redis
pnpm fixtures:pull --engine valkey
pnpm bench:clients
pnpm bench:clients --execution all
pnpm bench:clients --engine redis --workload get-256b-c32 --trials 5 --sample-ms 5000
pnpm bench:clients --engine redis --workload get-256b-c32 --construction call
pnpm bench:clients --engine redis --workload get-256b-c32 --latency-clock effect
pnpm bench:clients --engine redis --workload pipeline-32-c4 --session-connections 1
```

The default is both engines, native Effect versus Promise clients wrapped in
`Effect.tryPromise`, seven workloads, three independent trials, one-second warmup
and two-second samples. `--execution promise` measures plain Promise callers;
Effect Redis uses `ManagedRuntime.runPromise` per operation in that lane. Each
client/workload/trial runs in a fresh Node process; client order rotates across
trials. `--client`, `--warmup-ms` and `--sample-ms` support focused reruns. These
commands never join ordinary tests, CI or Release and never target shared endpoints.
`--construction call` constructs the public operation per iteration and rotates four
equal-length small GET keys; the default reuses its operation. `--latency-clock effect`
adds an `Effect.timed` cross-check inside the Effect lane, with its overhead included.
Keep these modes separate when comparing results.

All clients use RESP2, binary GETs and the same fixed payloads/concurrency. Cases
cover 256-byte GET at concurrency 1/32, 64-KiB GET at concurrency 8, SET, INCR,
32-GET pipelines and 8-GET transactions. Each reply is checked inside the timed
loop. Receipts separate command-completion latency from latency including verification.
The outer throughput window includes one runner entry and worker launch/join; the
in-program stopwatch includes worker launch/join without that runner edge. Both
exclude connection/setup/warmup and include scheduling, normalization and verification.
These are closed-loop measurements, not open-loop saturation or coordinated-omission-corrected latency estimates.

Batching is explicit for pipeline/transaction workloads. Ordinary commands use
documented client policies: ioredis automatic pipelining is disabled, node-redis
retains same-tick batching, and GLIDE uses native multiplexing. Effect Redis retains
its ordinary connection and scoped session pool (four session connections by default).
`--session-connections` changes only Effect Redis’s existing session-pool limit for a
separate matched experiment. Receipts record that policy and observed Node sockets;
GLIDE’s native sockets are not observed by this probe. These policies are recorded,
not treated as identical physical connections/writes. node-redis 6.3.0 decodes RESP2
EXEC blobs as strings; its adapter converts this fixture's ASCII payload back to
Buffer inside the measured operation. No arbitrary-binary transaction claim follows.

Ignored `results/benchmarks/<run-id>/` contains individual JSON receipts, host and
server identity, dependency/artifact/harness hashes, and a summary CSV. Reports
separate batches/sec from commands/sec, summarize p50/p95/p99 as medians of trial
percentiles, preserve throughput spread, and include CPU, sampled RSS, GC and event
loop delay. RSS includes the harness/Effect and GLIDE native allocations; it is not
a retained-memory/leak measurement. Missing/error/duplicate cells fail the run;
partial receipts remain available without a passing summary. Short smoke selections
verify the harness and must not be presented as performance rankings.

`runners/hardening/` owns measured Redis/Valkey TCP/TLS/local HTTP workloads, five-minute
native and sustained-HTTP Node/Bun cleanup soaks and 100 fresh fixture startups plus
delayed-start forwarding.
`fixtures/hardening/budgets.json` contains executable regression thresholds derived
from recorded calibration. Default `pnpm test:hardening` enforces those budgets;
`--calibrate` is diagnostic and cannot pass the release gate. Node exposes GC for soak
measurements; Bun uses native GC and reports unavailable GC timing/timer enumeration
as null. Both verify server-side client cleanup. Hardware, versions, images, server
configuration hashes and client/server resource measurements accompany each run.
Immutable evidence stays under `results/hardening/<run-id>/` and `results/artifacts/<run-id>/`.
Hardening runs locally through its command; hosted providers remain a
separate dispatch-only workflow with isolated secrets. No performance gate implicitly
contacts a real hosted database or loads a local credentials file.

Hosted Worker control responses carry deployment identity and `no-store`; a public
per-run URL nonce is independent of its bearer key. Access probes wait only for the
selected deployment. A wrong access status from that deployment fails immediately;
Redis mutation scenarios are never retried. Each hosted run verifies restoration of
the original Worker code and zero remaining bindings, including failed setup.
