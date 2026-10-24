# Implementation progress

This tracked index records implementation state. Detailed local investigations may
exist under ignored research, but no build, test or maintained document requires it.
The root [AGENTS.md](../../AGENTS.md) owns engineering and architecture policy.

**Current:** phase 02 complete; next: phase 03 (native Node transport).
The package has a bounded binary RESP codec, validated configuration, scoped transport
contracts, 343 offline tests and tracked release/fixture/scenario specifications. Network
connections, command execution, server certification and publication remain unimplemented.

## Status and gates

Statuses: pending, active, blocked, complete. Complete means the phase's promised
behavior, applicable checks and report are verified. A checkpoint or release-ready
artifact does not mean a phase requiring publication is complete. Dependencies below
refer to verified phases, not merely files or merge commits.

| ID  | Phase / minimum gate                                                                             | Dependencies | Status   | Report                                 |
| --- | ------------------------------------------------------------------------------------------------ | ------------ | -------- | -------------------------------------- |
| 00  | Planning: architecture, tests, phase gates and reporting guide                                   | None         | Complete | [Planning](reports/00-planning.md)     |
| 01  | Contracts/test foundation: Effect Vitest, validated config and pinned release/scenario manifests | 00           | Complete | [Foundation](reports/01-foundation.md) |
| 02  | Protocol: lossless bounded RESP codec, fragmented/malformed/property corpus                      | 01           | Complete | [Protocol](reports/02-protocol.md)     |
| 03  | Node transport: scoped native TCP/TLS and real Redis/Valkey fixture lifecycle                    | 01, 02       | Pending  | —                                      |
| 04  | Connection: handshake/admission/pending ownership, cancellation and no unsafe replay             | 02, 03       | Pending  | —                                      |
| 05  | Command system: descriptors, typed facade/Schema slice and inference contracts                   | 04           | Pending  | —                                      |
| 06  | Core commands: ordinary data families and reviewed versioned coverage                            | 05           | Pending  | —                                      |
| 07  | Sessions: pipelines, partial outcomes, WATCH/MULTI/EXEC and blocking leases                      | 04–06        | Pending  | —                                      |
| 08  | Streams/scans: cursor semantics, groups, claims, acknowledgments and restart recovery            | 06, 07       | Pending  | —                                      |
| 09  | Subscriptions: Pub/Sub/pushes, tracking, overflow/gaps and safe cache invalidation               | 07, 08       | Pending  | —                                      |
| 10  | Scripting/admin: per-node recovery, explicit modes and standalone inventory closure              | 07, 09       | Pending  | —                                      |
| 11  | Cluster: binary slots, routes, redirects, reshard/failover and multi-key constraints             | 06–10        | Pending  | —                                      |
| 12  | Sentinel: separate auth, role verification, discovery and real failover                          | 04, 07, 10   | Pending  | —                                      |
| 13  | Modules: versioned JSON/search/time-series/probabilistic/vector commands                         | 05–11        | Pending  | —                                      |
| 14  | Bun: actual native runtime lifecycle/command/topology evidence                                   | 03–12        | Pending  | —                                      |
| 15  | Upstash HTTP: endpoint/SSE semantics, lossless limits and separate extensions                    | 05–10, 13    | Pending  | —                                      |
| 16  | Cloud profiles: credentials/reauthentication, restrictions and identity policy                   | 11–15        | Pending  | —                                      |
| 17  | Engine certification: seven named engines and declared version/configuration scenarios           | 06–16        | Pending  | —                                      |
| 18  | Provider certification: named hosted deployments and Deno/Workers HTTP evidence                  | 15–17        | Pending  | —                                      |
| 19  | Hardening: fault/soak/performance budgets, docs and release-blocking backlog closure             | 01–18        | Pending  | —                                      |
| 20  | Release: exact artifact/consumer validation, authorized publication and registry smoke checks    | 19           | Pending  | —                                      |

## Reporting workflow

Before a phase, inspect this index, the [backlog](backlog.md), its prerequisite reports
and actual code/configuration. Implement only authorized work; internal milestones
do not change the broad v1 target or authorize external publication/provisioning.

Write one cumulative report per phase under reports/NN-topic.md using the
[template](phase-report-template.md). Update it at completion and at any interruption,
blocker or handoff. Preserve prior attempts/results with concise dated checkpoint
entries rather than rewriting a failed run as a pass.

Each report records delivered behavior, evidence, exact verification, decisions,
deferred/backlog IDs and next actions. Add its link here once it exists. Update
current/next status and affected backlog entries in the same meaningful commit.

Unfinished promised work stays in that phase or explicitly blocks a later assigned
phase; it cannot disappear as an informal TODO. Nonblocking future scope is distinct
from release-blocking deferred work. Every item needs an owner phase and closure
criterion. Report a skipped/unavailable test honestly; no tests is not evidence.

Compatibility evidence separates implementation, availability, semantics and test
outcome. Real runtime/provider certification requires executed evidence for named
versions/configurations. Local fakes, metadata or cached external results do not
establish it.
