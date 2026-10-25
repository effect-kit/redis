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

- `pnpm test`: offline unit and controlled integration suites via `vitest.config.ts`.
- `pnpm --filter @envoy1084/effect-redis test:unit`: unit suite only.
- `pnpm fixtures:check`: validate image pins, target versions and module profiles.
- `pnpm fixtures:pull --engine valkey`: explicitly prepare pinned images.
- `pnpm test:live`: native/backend integration and e2e via `vitest.live.config.ts`.
- `pnpm test:live --engine valkey`: select the engine's applicable live cases.
- `pnpm test:protocol:fuzz`: built codec corpus in a worker with an external deadline.
- `pnpm typecheck`: includes `types/`; Vitest never executes those contracts.

Both Vitest configs keep the package root explicit, disable env-file loading and
fail on empty selections. The offline config never selects native/server suites,
even when live-mode environment variables are present. Live tests need Docker and
OpenSSL plus prepared images; no automatic downloads or container reuse. Engine
versions, architectures and actual modules come from `fixtures/backends/` and are
validated before image preparation/acquisition. Expected command metadata is reviewed
separately in `fixtures/commands/` and checked against production descriptors.

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

The live runner also supports `--mode binary --engine redis|valkey --binary /absolute/path`
for an owned local process. `--mode endpoint` requires `EFFECT_REDIS_TEST_URL` and
only authenticates and sends read-only PING/ECHO; optional `EFFECT_REDIS_TEST_CA`
supplies a CA file. These smoke checks do not certify a deployment's command support.
Mutating cases use disposable fixtures and unique prefixes, never shared-server FLUSH.

Live JUnit/JSON and fixture evidence go to ignored `results/`, collected by CI.
Main pushes run live CI automatically; PR live runs require authorized manual
selection. Keep that authorization controller under root `.github/`, separate from
untrusted package code. See the workspace README for CI triggers and backend scope.
