# Phase NN — Title

Updated: YYYY-MM-DD. Status: pending / active / blocked / complete.
Commit(s): exact implementation/evidence commits when available.
Scope: named contracts, runtimes/backends/configurations and relevant scenario IDs.

## Entry and intended outcome

Required earlier phases/reports and whether their gates are verified. State the
observable behavior promised by this phase. Identify approved scope changes explicitly.

## Delivered behavior and ownership

Describe what works, public API/configuration changes and relevant owning modules.
Distinguish implemented behavior, declaration-only interfaces and future targets.
Use repository-relative links to actual files; do not dump a chronological edit log.

## Verification evidence

| Command / scenario IDs | Configuration / fixture / artifact                                    | Result and counts                          | Fresh or cached  |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------ | ---------------- |
| Exact executed command | Exact server/runtime/module/protocol/topology versions where relevant | Pass/fail/not-run; tests and skipped cases | State explicitly |

Record formatter, lint, source/test/tool/type-contract checks, tests, builds and
phase-specific lanes that ran. Explain skipped/blocked checks and their effect on
the gate. Link safe durable run artifacts or record small essential observations.
Never paste secrets, credential URLs, real keys/values or unredacted packet captures.

## Acceptance criteria

| Gate / scenario            | Status                                   | Evidence or remaining work |
| -------------------------- | ---------------------------------------- | -------------------------- |
| Each meaningful phase gate | Met / unmet / not applicable with reason | Observable evidence        |

A generic successful command or zero tests cannot satisfy unrelated acceptance gates.

## Decisions and compatibility changes

Record non-obvious design decisions, alternatives that affect maintenance, dependency
justifications, public result/error changes and backend limitations discovered.
Distinguish documented assumptions from executed results. Update owning maintained
docs/contracts rather than leaving durable decisions only in this report.

## Deferred, blocked and pending work

| Backlog ID                  | Reason / impact     | Owner phase | Release blocking?             | Closure criterion               |
| --------------------------- | ------------------- | ----------- | ----------------------------- | ------------------------------- |
| Stable ID linked to backlog | Concrete limitation | NN          | Yes / no with scope rationale | Test or artifact that closes it |

No deferred item without an owning phase and closure test. Required unfinished work
keeps this phase incomplete unless it has an explicit later gate and coherent scope.

## Next action

Exact next task for resuming this phase or the next authorized phase, prerequisites,
environment needs and unresolved decisions. Do not automatically claim authorization
to publish, provision paid resources or advance beyond the user's requested phase.

## Checkpoint history

- YYYY-MM-DD: attempt/checkpoint, delivered subset, actual blocker and next action.
