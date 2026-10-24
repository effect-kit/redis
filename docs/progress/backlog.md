# Decisions, deferred work and release blockers

This is not a duplicate list of every roadmap task. Track unresolved decisions,
external prerequisites, regressions and deferred promised work here. Ordinary phase
implementation is tracked in the [status index](README.md).

B003 is closed by the [protocol report](reports/02-protocol.md).
B001 and the phase-01 planning portion of B002 are closed by the
[foundation report](reports/01-foundation.md). B002 refinements and B005 actual
provider/build evidence remain release blockers in their owning phases. Owner means
the responsible phase; no individual assignee is inferred. Retain closure history.

| ID   | Item and closure criterion                                                                                                                                                                           | Owner        | Release blocking                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------- |
| B001 | Closed (01): Effect Vitest 4.0.6, Vitest 5.0.5, Vite 8.3.5; 55 tests, TS7 and clean-copy frozen install verified                                                                                     | 01           | No; closed by phase 01                |
| B002 | Phase-01 baseline frozen: version/source pins and all target/scenario owners assigned. Refine module ABI/option subsets and capture exact managed-service builds/configurations before certification | 13/18        | Yes; phase-01 planning portion closed |
| B003 | Closed (02): bounded streamed blob strings/arrays/maps/sets implemented and tested; protocol profile explicitly excludes private replication/RDB framing                                             | 02           | No; closed by phase 02                |
| B004 | Finalize typed partial pipeline/EXEC outcome API, including known/unsent/uncertain slots, with real disconnect regressions                                                                           | 07           | Yes                                   |
| B005 | Obtain isolated live-provider/runtime fixtures; record exact service/engine builds and configuration digests for all advertised configurations, then execute certification                           | 18           | Yes                                   |
| B006 | Set workload-derived numerical latency/memory/soak budgets and pass them on the release candidate                                                                                                    | 19           | Yes                                   |
| B007 | Verify package identity/ownership, publication access and explicit release authorization before publication                                                                                          | 20           | Yes for actual release                |
| F001 | Native Deno/edge TCP adapters beyond the declared HTTP runtime target                                                                                                                                | Future scope | No; do not advertise as supported     |
| F002 | Replication/RDB transfer and private import/migration workflows outside the declared application-client scope                                                                                        | Future scope | No; keep explicit scope boundary      |

When an implementation reveals new work, use the next B or F ID, link its phase
report, record impact and assign a measurable closure condition. B items affect a
promised v1 contract; F items are explicitly outside it. Moving an item between them
requires a recorded scope decision, not a deadline-driven downgrade.

Release-critical quarantined tests or unavailable fixtures remain blockers. Source
metadata, upstream documentation and local mocks cannot close a live-certification
entry. A later phase can own a dependency without pretending an earlier phase proved it.
