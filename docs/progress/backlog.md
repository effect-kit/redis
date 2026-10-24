# Decisions, deferred work and release blockers

This is not a duplicate list of every roadmap task. Track unresolved decisions,
external prerequisites, regressions and deferred promised work here. Ordinary phase
implementation remains pending in the [status index](README.md).

All entries below are open at the planning baseline. Owner means the responsible
phase; no individual assignee is inferred. Do not silently remove entries: close
with evidence in an owning report and retain concise history.

| ID   | Item and closure criterion                                                                                                               | Owner             | Release blocking                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------- |
| B001 | Adopt and verify exact Effect Vitest/Vitest/Vite dev toolchain with meaningful nonempty tests and TS7 checks                             | 01                | Yes                               |
| B002 | Freeze finite server-version window, module versions and exact fixture/cloud configurations; assign all public records and scenarios     | 01, refined 13/18 | Yes                               |
| B003 | Decide/implement declared streamed RESP3 forms and document any protocol boundary with tests; do not imply replication/RDB support       | 02                | Yes for declared protocol claims  |
| B004 | Finalize typed partial pipeline/EXEC outcome API, including known/unsent/uncertain slots, with real disconnect regressions               | 07                | Yes                               |
| B005 | Obtain explicitly configured isolated live-provider/runtime fixtures; every advertised hosted configuration needs executed certification | 18                | Yes                               |
| B006 | Set workload-derived numerical latency/memory/soak budgets and pass them on the release candidate                                        | 19                | Yes                               |
| B007 | Verify package identity/ownership, publication access and explicit release authorization before publication                              | 20                | Yes for actual release            |
| F001 | Native Deno/edge TCP adapters beyond the declared HTTP runtime target                                                                    | Future scope      | No; do not advertise as supported |
| F002 | Replication/RDB transfer and private import/migration workflows outside the declared application-client scope                            | Future scope      | No; keep explicit scope boundary  |

When an implementation reveals new work, use the next B or F ID, link its phase
report, record impact and assign a measurable closure condition. B items affect a
promised v1 contract; F items are explicitly outside it. Moving an item between them
requires a recorded scope decision, not a deadline-driven downgrade.

Release-critical quarantined tests or unavailable fixtures remain blockers. Source
metadata, upstream documentation and local mocks cannot close a live-certification
entry. A later phase can own a dependency without pretending an earlier phase proved it.
