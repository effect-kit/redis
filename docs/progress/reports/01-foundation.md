# Phase 01 — Contracts, Effect Vitest and release manifests

Updated: 2026-10-25. Status: complete for the phase-01 foundation.
Commits: the implementation commit containing this report (see Git history).
Scope: CONFIG, controlled TRANSPORT-01–08 and SPEC-01–06; no server certification.

## Entry and intended outcome

[Phase 00](00-planning.md) was complete and the working tree was clean. Read the
repository instructions, installed Effect 4.0.6 agent/testing/Schema/resource docs,
source APIs and local phase plan before implementation. Preserve RedisArgument and
provide a tested contract/tooling foundation for phases 02/03.

## Delivered behavior and ownership

- Cataloged dev-only @effect/vitest 4.0.6, Vitest 5.0.5 and Vite 8.3.5 after checking
  registry peers/Node engines. Vitest requires Vite; automatic peers remain disabled
  and strict peer validation remains enabled. Effect stays the sole runtime peer.
- Replaced empty node --test with offline Vitest. Separate source/test/tool TS7
  configurations, lint coverage, nonempty discovery and explicit `envDir: false`.
  Deterministic fixture timeout uses TestClock and an explicit write barrier;
  manifest file-I/O tests use it.live. No permanent framework-only smoke tests.
- [Configuration](../../../packages/redis/src/RedisConfig.ts) validates endpoints,
  URL credentials/database normalization, TLS/client-material pairs, protocol and
  count/byte/time limits. Rejects excess fields and conflicts. Credentials/TLS
  material use Redacted; failures omit input/URL/Schema issue trees.
- Preserved RedisArgument while extracting its owning module. Added lossless
  [RESP value contracts](../../../packages/redis/src/protocol/RespValue.ts), typed
  configuration/transport errors and the internal scoped Transport service.
  These are contracts, not an encoder/decoder or native network implementation.
- Added bounded per-test controlled transport with incoming chunks/EOF/failures,
  explicit partial-write acceptance/failure, copied observations and scoped handle
  counters. Tests cover close/unwind, blocked writes, deadline interruption, injected
  errors, invalid acceptance and retired-handle acquisition. It is not a Redis fake.
- Added tracked [release specifications](../../../spec/README.md): 741 names in 30
  category files, 34 provenance records, 20 native/module/runtime fixtures, 21 hosted
  configurations, 14 runtime pairs, four topology fixtures and 31 scenario families.
  Every inventory operation has classification, typed-coverage plan, mode, owner,
  source and scenario assignments. All commands and external targets remain not-run.
- Added Effect schemas for executable scenario definitions, compatibility records
  and run evidence. Availability, semantic parity and execution remain independent.
  Gates reject missing targets/references/counts, category hash drift, unassigned
  baseline typed coverage, misleading container coverage and unevidenced passes.
- Added `pnpm check:spec`; default tests validate the same tracked inputs. Turbo
  hashes spec/**. The [foundation contract](../../architecture/foundation.md), root/
  package READMEs and AGENTS.md describe actual behavior and future boundaries.

## Verification evidence

Runtime/toolchain: Node 24.22.0, pnpm 12.14.0, Effect/@effect/vitest 4.0.6,
Vitest 5.0.5, Vite 8.3.5, TypeScript 7.0.2, tsdown 0.23.1, Publint 0.3.25.

| Command / scenario                                                                                          | Configuration / fixture / artifact                                                     | Result and counts                                                                                                      | Fresh or cached                                                                                         |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                            | Actual workspace, strict peers/catalog                                                 | Passed; lockfile unchanged                                                                                             | Existing install; frozen resolution                                                                     |
| `pnpm check`                                                                                                | Actual workspace; format, lint, root/source/test/tool types, Vitest and tsdown/Publint | Passed; 3 files, 55 tests, zero skips                                                                                  | Fresh package lint/types/test/build; final build task reused the build just produced by test dependency |
| `pnpm check:spec`                                                                                           | Tracked inputs only                                                                    | Passed: 741 commands / 30 categories / 20 native fixtures / 21 hosted configurations / 14 runtime pairs / 31 families  | Fresh local read/schema/reference/hash checks                                                           |
| `pnpm install --frozen-lockfile --offline`                                                                  | Temporary clean Git checkout, no research/node_modules/.turbo/dist copied              | Passed; 145 packages installed, hooks installed                                                                        | Fresh node_modules from existing verified pnpm store; no new registry download                          |
| `pnpm check` and `pnpm check:spec`                                                                          | Same clean checkout                                                                    | Passed; 55 tests, zero skips, no research dependency                                                                   | Fresh lint/types/test/build; final duplicate build task cached                                          |
| `pnpm --filter effect-redis pack --pack-destination <temporary-directory>` plus Python tarfile/import audit | Actual built private package                                                           | Passed: 30 entries, only dist/README/package.json, only Effect external import/peer, no test/tool/spec/research assets | Fresh temporary pack and inspection                                                                     |
| `git diff --check` and handwritten TS line-count audit                                                      | Source, tests and tools                                                                | Passed; largest file 213 lines                                                                                         | Fresh inspection                                                                                        |

The clean-copy check used only files returned by Git's tracked/nonignored inventory,
initialized a temporary Git repository, installed from the frozen lockfile and ran
the commands above. Afterward, the final explicit dotenv-isolation config change
was typechecked/tested again in the actual workspace.

38 configuration tests, eight controlled transport tests and nine specification
checks are actual executed cases. No Redis/Valkey process, native socket, cloud,
Bun/Deno/Workers execution or live conformance test ran: those belong to later phases.
No external-evidence task exists as an empty passing job. No package was published.

## Acceptance criteria

| Gate                                                                         | Status                    | Evidence                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| P01-T01/T02: compatible Effect test tooling and owning configurations        | Met                       | Strict frozen install, TS7 source/test/tool checks, nonempty offline tests                                    |
| P01-T03: validated config and lossless value/error/transport contracts       | Met                       | CONFIG tests, public declarations/build, retained RedisArgument                                               |
| P01-T04: scoped controlled byte fixture with explicit barriers               | Met                       | TRANSPORT-01–08; cleanup, partial writes/failure, cancellation and bounds                                     |
| P01-T05: tracked source/spec inventory with complete phase assignments       | Met                       | 741 entries, 30 intact category checksums, baseline/reference/coverage checks                                 |
| P01-T06: finite version/module/runtime window and hosted configuration plans | Met for planning baseline | Immutable native source revisions, exact runtime/module choices; managed build capture explicitly gated below |
| P01-T07: independent scenario/compatibility/evidence schemas                 | Met                       | SPEC tests for missing targets, invalid definitions and unsupported evidence claims                           |
| Workspace/build/package hygiene                                              | Met                       | Aggregate checks, clean-copy install/checks, Publint and package audit                                        |

## Decisions and compatibility changes

- Configuration decoding is public working behavior. RESP values and Transport are
  representation/mechanical contracts. No no-op public Redis Layer was introduced.
- Defaults are finite initial policy values, not measured hardening/performance
  guarantees. Codec/scheduler enforcement is owned by phases 02/04 and measurement
  by phase 19. HTTP and topology configuration will have their own boundaries.
- Native fixture source pins are immutable revisions; actual binary/build settings
  are recorded when fixtures execute. Managed services can auto-patch or hide a
  selectable patch version. Their exact product/topology/auth plans and documentation
  snapshots are frozen now; actual engine/service build plus configuration digest
  is mandatory at phase-18 certification (B005), never invented in phase 01.
- Module source versions are selected and pinned. ABI/command-option availability
  on those combinations remains phase 13 work, tracked in B002. Planning completeness
  is separate from runtime/provider certification; the broad v1 scope is retained.
- Upstream native tags/revisions and hosted documentation digests were fetched
  during this phase. Command metadata/source hashes reuse the prior pinned research
  snapshots with provenance; no command availability was reclassified as tested.
- Category checksums use canonical compact JSON to survive formatting. Category
  files are declarative inventory and may exceed 500 lines; handwritten TS stays
  below 500. No copied upstream implementation/prose or ignored research is shipped.
- Command-mode assignments are planning seeds. Production descriptors, option-aware
  replies, keys and replay/mode policy require phase-05 semantic review and tests.

## Deferred, blocked and pending work

| Backlog             | Remaining work / impact                                                                  | Owner       | Release blocking       | Closure                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------- | ----------- | ---------------------- | ----------------------------------------------------------------------------------- |
| B001                | Closed by this phase                                                                     | 01          | No                     | Verified toolchain and 55 meaningful tests                                          |
| B002                | Planning baseline closed; module ABI/option and hosted version/config refinement remains | 13/18       | Yes                    | Verified actual module subsets and exact deployed configuration evidence            |
| B005                | Isolated provider/runtime fixtures and actual managed engine/build fingerprints          | 18          | Yes                    | Execute every advertised configuration's scenarios with version/config/run evidence |
| B003/B004/B006/B007 | Existing protocol, batch outcome, measured hardening and release-access gates            | 02/07/19/20 | As recorded in backlog | Owning phase reports and acceptance evidence                                        |

No unfinished phase-01 behavior is silently moved to later work. Missing live
fixtures are visible later release blockers and have not been converted into passes.

## Next action

Phase 02: implement the bounded binary RESP encoder/incremental decoder against these
contracts, with independent known frames, every-split/malformed/truncated cases and
exact-number tests. Read the installed Effect APIs and tracked progress first.
Phase 02 has not been started by this implementation request.

## Checkpoint history

- 2026-10-25: started from clean tree; installed strict dev peers and implemented
  contracts/tests. An initial run failed 1/41 cases due to an unavailable Fiber.poll
  API; corrected against installed Fiber.pollUnsafe. Syntax/import/lint setup failures
  were fixed before acceptance. Final suites pass 55/55 with no skips.
- 2026-10-25: froze inventory/fixture plans, passed workspace and clean-copy gates,
  inspected package contents and completed phase-01 documentation/progress tracking.
