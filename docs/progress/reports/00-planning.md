# Phase 00 — Architecture, roadmap and progress workflow

Updated: 2026-10-25. Status: complete for planning only.
Implementation phases 01–20 remain pending. No publication or live compatibility
certification has occurred.

## Delivered

Created a local ignored implementation guide with five architecture chapters, four
testing chapters and twenty ordered implementation phases through release. Each
phase defines entry dependencies, implementation tasks, meaningful tests, exit gates
and reporting. The guide preserves the broad v1 engine/provider/runtime/topology scope.

Added the tracked [status index](../README.md), [backlog](../backlog.md) and
[report template](../phase-report-template.md). Updated root agent instructions with
file/comment/Effect-testing policy and mandatory phase checkpoints/reports. These
tracked records remain useful without ignored research and do not depend on it at runtime.

## Evidence and decisions

- Inspected actual package exports, workspace catalogs/scripts/CI, clean working tree,
  installed Effect 4.0.6 AGENTS.md and local testing examples.
- Inspected @effect/vitest 4.0.6 published declarations: it.effect/it.live are scoped;
  shared layer and Schema/Arbitrary property APIs are current v4 contracts.
- Registry peer metadata identifies Vitest >=5 <6 and a required Vite peer. Proposed
  exact dev versions are @effect/vitest 4.0.6, Vitest 5.0.5 and Vite 8.3.5, subject to
  an actual clean workspace install/test/build in phase 01. None is installed here.
- Keep real networking/provider tests on live services/clocks, deterministic policy/
  race tests on TestClock and controlled transport. Reuse scenarios without building
  a second Redis client in test support.
- Keep source/tests below 500 handwritten lines, review splitting near 400, and use
  short comments for non-obvious invariants. Preserve justified generated/fixture exceptions.

## Verification

| Check                                                       | Result                                                                               | Evidence scope                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `python3 research/implementation/validate-plan.py`          | Passed: 20 phases, 120 unique tasks, earlier-only dependencies, resolved local links | Local planning consistency; not behavior                                                    |
| `pnpm exec oxfmt --write AGENTS.md README.md docs/progress` | Passed                                                                               | Maintained Markdown formatting                                                              |
| `pnpm check`                                                | Passed                                                                               | Fresh formatting/root checks; package lint/typecheck/test/build tasks were Turbo cache hits |
| Existing package test task                                  | Zero tests                                                                           | Empty scaffold node --test; not Effect Vitest or conformance evidence                       |

No Effect Vitest, server, Cluster/Sentinel, Bun, cloud or publication tests ran.
The proposed dev toolchain still needs phase-01 installation and execution.

## Pending work and next action

[B001–B007](../backlog.md) remain open. Start phase 01 by validating exact peers,
adopting the dev-only Effect Vitest toolchain and implementing/test-driving the
configuration/contract foundation. Inspect current code first and preserve the
existing RedisArgument public export. No runtime implementation was added here.

## Checkpoint history

- 2026-10-25: planning guide and reporting workflow prepared; implementation pending.
