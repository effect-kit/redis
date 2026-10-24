# Phase 02 — Lossless bounded RESP codec

Updated: 2026-10-25. Status: complete.
Commits: implementation commit containing this report (see Git history).
Scope: WIRE-01–09, SPLIT-01–03, LIMIT-01–15; controlled bytes only.

## Entry and intended outcome

Phase 01 was complete at 596c464 and the starting tree was clean. Read repository
instructions, installed Effect 4.0.6 docs/testing/error/Result APIs, phase plan and
current code before implementation. Review the official Redis protocol reference
and RESP3 specification 1.6, including attribute placement, top-level pushes,
streamed forms and pre-7.2 libc NaN compatibility. No new dependencies.

## Delivered behavior and ownership

- [Encoder](../../../packages/redis/src/protocol/encode.ts): nonempty ordered string/
  byte tokens, byte-accurate UTF-8 lengths, empty/binary/multiword arguments, owned
  output and pre-allocation request/argument/count budgets. No implicit numeric or
  JSON conversion. Isolated UTF-16 surrogates match TextEncoder replacement behavior.
- [Decoder](../../../packages/redis/src/protocol/decode/Decoder.ts): pure incremental
  feed/next/end API returning Effect Result. All existing RespValue kinds, exact
  integer/big-number values, preserved floating tokens, RESP2/3 null distinctions,
  nested errors, duplicate/binary map keys, verbatim data, attributes and pushes.
- Streamed blob strings and arrays/maps/sets implemented with cumulative limits,
  pair validation and explicit terminators. No declared RESP3 streamed form was
  deferred. Private replication/RDB/EOF framing remains outside scope.
- Owned block queue/builders, reusable cleared spare input block, amortized queue
  compaction, one final payload join, explicit aggregate stack and terminal failure
  retirement. Conservative retained-wire bytes include completed children of an
  incomplete root value; no unbounded output batch or preallocation from declarations.
- [ProtocolError](../../../packages/redis/src/errors/ProtocolError.ts) exposes safe
  stage/kind/absolute offset/limit details. Expected failures remain typed Results;
  unexpected defects propagate. Error state releases partial buffers and subsequent
  calls return the same error. EOF requires a final drain to detect truncation.
- Reused phase-01 Schema budget fields. Added DOM type declarations for standard
  TextEncoder/TextDecoder globals while retaining ES2022 and no Node/Bun imports.
  Allowed only Effect's conventional `_tag` discriminator in the existing underscore
  lint rule. Public codecs compose through Effect.fromResult; no Effect per byte.
- [Protocol profile](../../../spec/protocol.json) registers 27 scenario definitions,
  source references, supported forms and boundaries. Schema/reference/evidence gates
  validate them. WIRE/SPLIT/LIMIT records contain protocol-only run evidence; all
  command/native/module/provider/runtime certification records remain not-run.
- Added three seeded properties, independent fixed frames, exhaustive split/prefix
  schedules and malformed/resource/ownership regressions. Added the built-artifact
  watchdog corpus and CI lane. Updated public docs, agent instructions and progress.

## Verification evidence

Node 24.22.0, pnpm 12.14.0, Effect/@effect/vitest 4.0.6, Vitest 5.0.5,
TypeScript 7.0.2, tsdown 0.23.1 and Publint 0.3.25. All fixtures are synthetic;
no Redis/Valkey processes, sockets, Bun/Deno/Workers or cloud endpoints were used.

| Command / scenario                                                                                   | Configuration / artifact                                           | Result / counts                                                                                                                    | Freshness                                                                             |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                     | Actual workspace, existing exact catalog/strict peers              | Passed; no dependency/lockfile changes                                                                                             | Existing installed store; frozen resolution                                           |
| `pnpm check`                                                                                         | Formatter, lint, root/source/test/tool TS7, Vitest, tsdown/Publint | Passed: 10 files, 343 tests, zero skips                                                                                            | Fresh lint/types/tests/build; final build task reused its immediately preceding build |
| `pnpm check:spec`                                                                                    | Tracked protocol/source/fixture/scenario manifests                 | Passed: 27 protocol definitions; 741 command names/30 categories; all declared target assignments intact                           | Fresh local read/schema/hash/reference checks                                         |
| `pnpm test:protocol:fuzz`                                                                            | Built artifact, external 15-second process deadline                | Passed: 20,000 cases, 18,631 expected rejections, 1,298 values emitted; 1,100,000 coalesced replies; 65,536 one-byte payload feeds | Fresh worker execution; build may reuse current artifact                              |
| Clean-copy frozen install/check/fuzz                                                                 | No research/node_modules/dist/.turbo copied                        | Passed: frozen offline install, 343 tests, full checks/spec gate and identical watchdog statistics                                 | Fresh node_modules from existing store; fresh checks/worker, duplicate builds cached  |
| `pnpm --filter effect-redis pack --pack-destination <temporary-directory>` plus tarfile/import audit | Private built package                                              | Passed: 52 entries; only dist/README/package.json; only Effect runtime import/peer                                                 | Fresh temporary artifact inspection                                                   |
| Source import, handwritten line-count and `git diff --check` audits                                  | Protocol and supporting TS                                         | Passed; no Node/Bun/Buffer imports, largest handwritten file 327 lines                                                             | Fresh inspection                                                                      |

The 343 registered cases include 51 independent complete-value fixtures, each tried
at every two-chunk split, in one-byte delivery and at every nonempty truncated prefix.
They include real Redis-style blob pushes, non-ASCII/BOM/binary payloads, nested
attributes/errors and mixed fixed/streamed structures. Added 288 registered cases
relative to phase 01. Repeated parameterizations are protocol tests, not backend
compatibility cells.

Properties are configured for 1,300 successful generated runs in total:

- WIRE-08: 300, seed `resp-command-02`; independent UTF-8 length and binary tokens.
- SPLIT-03: 500, seed `resp-values-02`; bounded depth 0–4, fixed/streamed forms and
  generated chunk partitions. Both encodings run for each generated value.
- LIMIT-12: 500, seed `resp-malformed-02`; bounded arbitrary bytes and typed outcomes.

Watchdog seed: 20261025. No property was falsified; no shrink artifact was generated.
The framework reports replay/shrink information on a failure. Named regressions
include numeric BOM handling and payload/input ownership. The watchdog is a finite
correctness/termination corpus, not a latency, RSS or provider certification.

Temporary packed artifact SHA-256:
`b814c5ffe9974fd7e52e8ac2e07be4431743d59abf4635f5695d6e172f045e91`.
Reviewed RESP3 source snapshot SHA-256:
`0aeda1fbed16511e8202a47424af24999ad0a3dfc6243968f2a189109d8341bf`.
The reviewed snapshot is ignored local evidence; no build/test needs it. Maintained
[source references](../../architecture/protocol.md) remain accessible independently.

## Acceptance criteria

| Gate                                                     | Status | Evidence                                                                                                 |
| -------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| P02-T01: binary request encoding                         | Met    | Exact frames, lengths, ownership, budget and generated command tests                                     |
| P02-T02: incremental scalar grammar                      | Met    | Every supported type, precision/special values, malformed numerics and EOF corpus                        |
| P02-T03/T04: aggregates, attributes, pushes and chunking | Met    | Explicit stack, ordered pairs, attached metadata, top-level pushes, every-split/one-byte/property corpus |
| P02-T05: malformed/limit/retention behavior              | Met    | All declared boundaries, conservative incomplete-value retention, terminal errors and watchdog corpus    |
| P02-T06/B003: streamed RESP3 decision                    | Met    | Bounded streamed strings/arrays/maps/sets implemented; undefined/private modes explicitly rejected       |
| Workspace/build/artifact hygiene                         | Met    | Full checks, Publint, package/import and line audits; clean-copy frozen install/checks/fuzz passed       |

## Decisions and compatibility changes

- Public low-level APIs return Result so parsing stays synchronous/pure; callers
  integrate through Effect.fromResult. Redis command Effects remain phase 04/05 work.
- feed copies input and strictly admits a whole offered chunk within remaining byte
  capacity. Future transport readers must partition/cooperate with that budget and
  drain between feeds; a coalesced tail cannot bypass retention accounting.
- maxBufferedBytes is a conservative logical wire budget, not heap/RSS. It includes
  consumed framing and unfinished root children; completed output becomes caller-owned.
  Count/depth bounds control object overhead; copying temporarily holds a constant
  number of payload copies plus bounded blocks. See the maintained codec contract.
- Streamed forms normalize into existing values rather than adding a second semantic
  type tree. Attribute chains retain their wrappers. Unknown push strings and map
  keys remain raw; nested pushes and odd streamed maps fail deterministically.
- Numeric headers retain BOM bytes for grammar checks; TextDecoder's default BOM
  stripping must not validate malformed numeric input. Redis <7.2 libc NaN tokens
  are accepted/preserved to match the pinned older-version window.
- No server compatibility, raw network command execution, replay or handshake claim
  follows from codec tests. Native server/runtime/provider tests remain later gates.

## Deferred, blocked and pending work

B003 is resolved by the implementation and explicit protocol profile. No required
phase-02 wire implementation is deferred. B002/B004/B005/B006/B007 and F001/F002
remain as recorded in the backlog: module/provider refinement, batch outcomes,
actual live fixtures, measured hardening, release access and explicitly excluded
native-edge/replication workflows. This phase neither provisions nor publishes.

## Next action

Phase 03 can implement scoped native Node TCP/TLS/Unix transport and real pinned
Redis/Valkey fixture acquisition, using the codec admission/EOF/ownership contract.
Phase 03 remains pending and has not been started by this phase-02 request.

## Checkpoint history

- 2026-10-25: started clean at 596c464. Initial compilation exposed missing global
  TextEncoder/Decoder declarations, a Result success-type mismatch and optional-state
  narrowing; fixed before acceptance. Protocol-aware lint configuration and test
  tuple decoding were corrected without weakening strict TypeScript/peer settings.
- 2026-10-25: independent corpus passed, then expanded to limit/property/watchdog
  cases. Review found and fixed BOM-stripping numeric acceptance; regression cases
  now reject it while preserving BOM payload bytes. Actual workspace passes 343/343.

- 2026-10-25: clean nonignored-file copy passed offline frozen installation, all
  343 tests and workspace/spec checks, plus the complete watchdog corpus. It had
  no research, dependencies, build output or Turbo cache at entry. Closed B003 and
  marked phase 02 complete; no server/provider/runtime certification was inferred.
