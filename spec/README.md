# Release specification and fixture plans

This tracked directory is the phase-01 v1 planning baseline. It is self-contained:
normal builds, tests and the specification check never read ignored research or
fetch upstream data. No command, native runtime or hosted service is certified here. Phase 02 adds
protocol-only execution evidence, kept separate from those target records.

- `release.json` preserves the required engines, provider families, modules,
  version window, runtime pairs and topologies. Review scope changes explicitly.
- `commands/index.json` indexes 741 unique researched names in 30 category files.
  Counts include containers, aliases, private operations and documentation stubs;
  they are not a count of implemented application commands.
- `commands/*.json` assigns classification, proposed typed coverage, execution mode,
  owning phase, source IDs and scenario families. All operations start planned/not-run.
  Internal wire/migration operations have explicit boundary classifications. Stubs
  require review; they do not establish availability or a callable grammar.
- `sources.json` records public URLs, revisions and SHA-256 snapshot digests. Core
  metadata hashes identify the aggregated metadata snapshot used during planning;
  hosted documentation hashes identify downloaded pages. These historical hashes
  are provenance, not live verification or a required copy of upstream source.
- `fixtures/native.json` pins seven engines, representative older Redis/Valkey
  releases, four module builds and four runtimes. Git revisions pin source fixtures;
  adapters must later record actual build options, artifact hashes and runtime versions.
- `fixtures/node-images.json` pins immutable multi-platform image digests for the
  seven phase-03 Redis/Valkey versions (including observed built-in module inventories)
  and a Node Alpine runtime for real-server
  Unix socket tests. Explicit fixture preparation downloads and
  tags them; test execution uses the digest without pulling. The spec gate checks
  target/version alignment and completeness. These are networking fixtures, not
  complete command/engine certification.
- `fixtures/hosted.json` names 21 configurations across nine provider families plus
  Redis Software, including selected topology/authentication variants. Their exact
  provisioned engine/service build is captured at certification: providers manage
  patching and some expose no customer-selectable immutable version. Each actual
  build/configuration fingerprint remains a release-blocking B005 evidence gate.
- `fixtures/runtime-pairs.json` names 14 native/HTTP/SSE combinations.
  `fixtures/topologies.json` names Redis/Valkey Cluster and Sentinel fixtures.
- `protocol.json` defines the implemented grammar, boundaries and 27 controlled-byte
  scenarios. WIRE/SPLIT/LIMIT evidence in scenarios.json refers only to these codec
  cases; native/command/provider records remain not-run.
- `transport.json` defines 35 executable Node networking scenarios. SOCKET evidence
  covers 43 parameterized live cases; it does not mark native engine/command/provider
  conformance targets as passed.
- `scenarios.json` assigns 31 scenario families. Owning phases add executable IDs,
  setup/assertion/cleanup definitions and actual execution evidence with their code.

Redis/Valkey source baselines are 8.10.2 and 9.1.2. The older window is Redis 6.2.19,
7.2.11, 7.4.6 and Valkey 7.2.11, 8.0.3. Selected alternatives are Dragonfly 2.0.2,
KeyDB 6.3.4, Redict 7.3.6, Garnet 2.2.4 and Kvrocks 2.17.0. Module source pins are
RedisJSON 2.8.19, RediSearch 2.10.31, RedisTimeSeries 1.8.26 and RedisBloom 2.4.27;
vector sets use the Redis baseline. Exact module ABI/option subsets are verified in
phase 13. These finite fixture choices do not imply all versions between them work.

## Maintenance and validation

Run `pnpm check:spec`. It checks schemas, unique identities, canonical category
checksums, counts, provenance/scenario references, baseline typed-coverage assignment,
required targets and execution-evidence constraints. `pnpm test` exercises the same
gates, including negative cases for missing scope and invented passes.

Category SHA-256 is computed over UTF-8 `JSON.stringify(JSON.parse(fileContents))`;
formatting whitespace does not change it. Update the corresponding checksum/count
when deliberately reviewing category changes. Changing an index does not authorize
changing the independent release scope. Command modes here are reviewed planning
seeds, not production routing/replay metadata; phase 05 must review option-sensitive
encoders/decoders and executable descriptor overlays against pinned source.

Effect schemas under `packages/effect-redis/tools/spec/Schema.ts` define scenario definitions
and compatibility records. Availability (supported/unsupported/unknown), semantic
parity (matching/different/unverified) and execution status are independent. Executed
results require a run ID, exact engine/runtime/module versions, transport, protocol,
topology, authentication, configuration digest, scenario IDs and evidence artifact.
Schemas validate evidence structure; only executed conformance establishes truth.
Detailed reports referenced by evidence artifacts live in ignored local research;
validators check their metadata without reading or requiring those private files.

Keep actual native/provider results not-run until their owning tests execute. Missing
credentials or fixtures do not become a pass. Do not provision paid deployments from
this manifest. Refine the fixture/option matrix in phases 13/18 without dropping the
broad v1 targets. Upstream metadata/code use remains subject to its upstream terms;
this inventory contains factual names and local classifications, not copied source.
