# Maintenance Policy

How Movehat is released, triaged, versioned, and deprecated. This document is the contract between maintainers and downstream users — anything you build on top of `movehat@latest` should fit within the guarantees and timelines below.

For security-specific policies, see [SECURITY.md](./SECURITY.md). For contributor guidelines, see [CLAUDE.md](./CLAUDE.md).

## Release cadence

Movehat follows three release rhythms:

- **Patch releases** (`0.2.4 → 0.2.5`) — ship when bugfixes or non-breaking polish accumulates. Typical cadence: every 1–3 weeks during active development. No advance notice required; release notes land in `CHANGELOG.md` under the new version section.
- **Minor releases** (`0.2.x → 0.3.0`) — ship when the public surface gains new exports, when behavior changes in a backwards-compatible way, or when pre-1.0 breaking changes accumulate. Typical cadence: every 4–8 weeks. Each minor release has a `CHANGELOG.md` entry listing what changed and any deprecation announcements.
- **Major releases** (`0.x → 1.0.0`) — single planned event when the API stabilizes. Pre-1.0 breaking changes ship in minor bumps; once 1.0 lands, breaking changes ship in majors only.

**Per-milestone batch merges**: feature work lands on the `develop` branch via sub-PRs. When a milestone closes, a single `develop → main` batch PR ships everything together, followed by a release PR that bumps the version and updates the changelog. This pattern is documented in [`CLAUDE.md` §7](./CLAUDE.md). The `publish.yml` workflow gates the npm push on a matching `CHANGELOG.md` section.

## Issue triage SLA

Maintainers commit to the following response times:

| Issue type | Acknowledgement | Label | Resolution path |
|---|---|---|---|
| Security report | 24 hours | n/a (private email) | See [SECURITY.md](./SECURITY.md) |
| Bug report | 3 business days | 5 business days | Next patch or minor release; clear timeline in the issue |
| Feature request | 5 business days | 7 business days | Triaged into the roadmap or closed with rationale |
| Question / discussion | 5 business days | n/a | Answered inline or pointed to docs |

"Acknowledgement" means a maintainer comment that confirms the report was seen, not that a fix is committed. "Label" means the issue has been categorized (`bug` / `feature` / `docs` / etc.) and assigned to a milestone or backlog.

Issues older than 90 days with no maintainer response should be re-pinged in the same thread — the team's notifications may have missed them.

## Versioning policy

Movehat follows [Semantic Versioning 2.0.0](https://semver.org/), with the conventions standard to a pre-1.0 library:

- **Patch (`0.2.4 → 0.2.5`)** — bug fixes, documentation, build improvements, dependency bumps that don't change behavior. Always safe to upgrade.
- **Minor (`0.2.x → 0.3.0`)** — new features, new exports, **and** breaking changes during the pre-1.0 phase. Breaking changes are called out explicitly in `CHANGELOG.md` under a `### Breaking` subsection.
- **Major (`0.x → 1.0.0` and onward)** — reserved for the 1.0 cut and subsequent stable-version breaking changes.

The implication for downstream users while Movehat is pre-1.0: **pin to the minor version** (`"movehat": "^0.2.0"` is too loose; prefer `"movehat": "~0.2.4"` or an exact version) until 1.0 lands. After 1.0, the standard SemVer caret range becomes safe again.

## Deprecation policy

Public-API symbols (anything re-exported from `packages/movehat/src/index.ts`) follow a **one-minor-release deprecation window** before removal:

1. **Mark deprecated** — the symbol gets a `@deprecated` JSDoc tag in the next minor release; the changelog entry calls it out explicitly with a migration path. The symbol stays functional for the entire next minor cycle.
2. **Remove** — the deprecated symbol is removed in the minor release **after** the one that marked it.

Precedent: the `mh()` legacy runtime helper was `@deprecated` from M2 onward (during the pre-`0.1.0` `0.0.0-dev` phase) and removed in M6 with the `0.0.0-dev → 0.1.0` bump. The deprecation window plus the version-bump signal gave downstream users a clear migration path. See [ROADMAP.md](./ROADMAP.md) §M2 and §M6 for the implementation arc.

For internal symbols (anything not re-exported from `index.ts`), no deprecation window applies — breaking internal changes can ship in patch releases.

## Movement CLI compatibility

Movehat shells out to the Movement CLI for compile, deploy, upgrade, and local-node operations. The Movement CLI is upstream of us and its release process is not under our control.

**Pinning policy**: every Movehat release documents the Movement CLI version it was developed and tested against in the `CHANGELOG.md` entry. The reference CI workflow in [`examples/counter-example/.github/workflows/ci.yml`](./examples/counter-example/.github/workflows/ci.yml) pins the Movement CLI binary by SHA256 because Movement Labs publishes new builds under a moving tag (`bypass-homebrew`). When you adopt a new Movehat release, check its changelog for any noted Movement CLI compatibility shift.

**Rotation procedure**: see the [CI tutorial troubleshooting section](https://movehat.org/docs/guides/tutorial-ci#sha256-mismatch) on the docs site.

## Contributor onboarding

If you want to contribute:

1. Read [CLAUDE.md](./CLAUDE.md) — the working agreement (behavioral guidelines, surgical-changes rule, install-experience gate, self-review requirement).
2. Skim the [Contributing guide](./packages/docs/content/docs/contributing/index.mdx) — workspace setup, dev loop, project architecture.
3. Read the [PR template](./.github/PULL_REQUEST_TEMPLATE.md) before opening a PR — every section is part of the merge checklist.
4. Run the install-experience gates locally (`pnpm check:example` + `pnpm test:smoke`) before requesting review; CI runs these too but pre-flight catches regressions before reviewers see them.

We don't have a formal review-assignment process today — small PRs (`docs`, `chore`, single-file fixes) get reviewed within the SLA above; larger PRs may need a synchronous handoff via the issue thread.

## Out of scope

This document covers maintenance policy, not technical architecture. For architecture, see [`ROADMAP.md`](./ROADMAP.md). For security disclosure, see [SECURITY.md](./SECURITY.md). For code-of-conduct guidance, no separate document exists today — issue threads and PR conversations are expected to follow standard open-source community norms (be respectful, assume good faith, focus on the work).
