# Releases

Use `pnpm changeset` to describe a public change. Choose patch for compatible fixes,
minor for new capabilities and major for breaking public contracts. Review breaking
changes carefully while the package is below 1.0. Changesets updates the package
version and generates `packages/redis/CHANGELOG.md` in the version PR.

## First publication: 0.0.0

The package intentionally stays at `0.0.0` with a pending **minor** Changeset for
`0.1.0`. Bootstrap the npm package before consuming that Changeset. These commands
publish publicly; run them only as a package owner from the reviewed checkout.
Node 24.22.0+, pnpm 12.14.0, Bun 1.4.4, Docker and prepared fixtures are required.

From the repository root:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm org ls effect-kit

pnpm install --frozen-lockfile
pnpm check
pnpm fixtures:pull --engine redis
pnpm fixtures:pull --engine valkey
pnpm release:pack
pnpm release:check

npm publish ./packages/redis/test/results/release/packages/effect-kit-redis-0.0.0.tgz --access public --tag bootstrap --provenance=false --ignore-scripts
pnpm release:smoke
```

`release:check` checks archive contents, declarations, README examples and real
Redis/Valkey operations through the packed Node/Bun/HTTP adapters. Publish that
exact tarball without rebuilding it. `release:smoke` downloads the registry archive,
checks its integrity against the candidate and repeats consumer checks. The
`bootstrap` dist-tag keeps `0.0.0` out of `latest` until the first normal release.

Local publication cannot carry GitHub Actions provenance. The explicit
`--provenance=false` override is for this bootstrap only. Later CI publications use
OIDC and provenance; no npm write token is stored in GitHub.

## One-time setup

1. After publishing `0.0.0`, open the package's npm **Settings → Trusted publishing**
   and add GitHub Actions with:

   | Field                | Value         |
   | -------------------- | ------------- |
   | Organization or user | `effect-kit`  |
   | Repository           | `redis`       |
   | Workflow filename    | `release.yml` |
   | Environment name     | `npm`         |

   Allow direct `npm publish` for this workflow. npm currently requires the first
   successful trusted publication within two days of creating the configuration;
   configure it when ready to release, or recreate it if it expires.

2. In GitHub, create the `npm` environment, restrict it to `main` and configure
   required reviewers if you want an approval before publication. No npm token
   secret is needed. Enable **Actions → General → Allow GitHub Actions to create
   and approve pull requests** so Changesets can open its version PR.
3. Enable private vulnerability reporting in the repository's security settings.
   Review npm organization publish access and package 2FA settings. After trusted
   publishing works, npm recommends requiring 2FA and disallowing token publishing.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for current
setup requirements. The repository and package must be public for provenance.

## Normal releases

1. Merge changes and their Changesets into `main`.
2. Dispatch **Release** on `main`. Pending Changesets create/update the version PR;
   this run does not publish.
3. Review and merge the version/changelog/lockfile PR. Bot-created PRs may need a
   maintainer-triggered CI run because GitHub suppresses workflow events from its
   own token; the publication job runs its checks independently.
4. Dispatch **Release** again. With no pending Changesets, the workflow validates
   the immutable selected commit, runs conformance, packs and checks the release,
   then publishes the same archive through the `npm` environment with provenance.
   It creates version tags/GitHub release notes and runs a registry smoke check.

```sh
gh workflow run release.yml --repo effect-kit/redis --ref main
```

Release, hosted-provider and hardening workflows remain manual. Inspect provider
and hardening evidence for the selected candidate separately; the release workflow
runs local container conformance without hosted credentials. It refuses publication
of `0.0.0`; that version is reserved for the manual bootstrap above.

If a release is faulty, prepare a patch Changeset and publish a corrected version.
Do not replace an existing tarball or rewrite a published version tag. Recheck
registry integrity and consumers after any recovery.
