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
- `pnpm --filter @envoy1084/effect-redis test:unit`: unit suite only.
- `pnpm fixtures:check`: validate image pins, target versions and module profiles.
- `pnpm fixtures:pull --engine valkey`: explicitly prepare pinned images.
- `pnpm test:live`: native/backend integration and e2e via `vitest.live.config.ts`.
- `pnpm test:live --engine valkey`: select the engine's applicable live cases.
- `pnpm test:bun --engine valkey`: run the selected backend through actual Bun processes.
- `pnpm test:upstash`: HTTP fetch faults, Redis/Valkey proxy cases and built Node/Bun consumers.
- `pnpm dev:upstash --engine redis --runtime all`: validate both consumers and retain an interactive fixture.
- `pnpm test:live --runtime node|bun|all`: select the runtime independently of the engine.
- `pnpm test:protocol:fuzz`: built codec corpus in a worker with an external deadline.
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
Main pushes run live CI automatically; PR live runs require authorized manual
selection. Keep that authorization controller under root `.github/`, separate from
untrusted package code. See the workspace README for CI triggers and backend scope.
