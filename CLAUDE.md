# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Split Big Work Into Sub-Issues

**Any milestone or feature that needs more than one PR must be broken into GitHub sub-issues, with each sub-issue detailed in `ROADMAP.md`.**

The rule:

- If the work cannot land in a single, reviewable PR, open a sub-issue for each PR you intend to ship. Use titles like `[M1.3] Migrate child_process callers to runCli`.
- Each sub-issue carries its own Definition of Done — the same level of mechanical precision the meta-issue uses (exact file paths, exact greps, exact test commands).
- The meta-issue (`[Roadmap] M1: …`) tracks the sub-issues. The meta-issue closes only when all sub-issues close.
- `ROADMAP.md` lists every sub-issue under its milestone, with links and a one-line summary of what each PR delivers.
- Each PR references its sub-issue with `Closes #<n>` and `Tracks #<meta>`.

When in doubt about granularity: prefer one sub-issue per logical refactor (e.g. "migrate the address helpers" is one sub-issue, "migrate the child_process callers" is another). A sub-PR that takes more than a day of focused work is a sign it should be split further.

## 6. The Example is a Scaffold, Not a Migration Target

**`examples/counter-example/` is the canonical scaffold — the reference implementation of "how to use movehat" that users read, copy, and trust. Users do not migrate; *we* maintain it so that anyone running `npm install movehat` lands on a working setup. README.md and `packages/docs/` must reflect the same shape the example exhibits.**

Three things follow from this:

### 6.1 Tier 1 — Type compatibility (fast, auto, pre-push)

- Hook lives at `.husky/pre-push` and runs in two phases:
  1. `pnpm build:movehat` — packages/movehat/src compiles cleanly. Failure here is a TypeScript error inside the package, not an example concern.
  2. `pnpm typecheck:example` — `tsc --noEmit` over `examples/counter-example` against the freshly built movehat. Failure here means the public surface of `movehat` / `movehat/helpers` changed in a way the example can no longer consume.
- Both can be invoked together as `pnpm check:example` (~10s total, no network, no keys).
- Skip flag for intentional WIP pushes: `MOVEHAT_SKIP_EXAMPLE_CHECK=1`. The unit-test gate remains mandatory regardless.

**Strictness asymmetry (deliberate):** `examples/counter-example/tsconfig.json` enables `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`, all of which `packages/movehat/tsconfig.json` does not enable. That makes the example **the strictest consumer** of the movehat public surface. Code that compiles inside movehat but fails in the example is a signal that the API is fragile for end users — fix the API, do not loosen the example.

**Caveat:** typecheck only verifies *types* against the workspace symlink. Runtime behaviour and what's actually packaged into the npm tarball are covered by Tiers 2 and 3.

### 6.2 Tier 2 — Per-PR runtime + install smoke (manual, honor-system, mandatory)

Two scripts, both run before opening / re-requesting review on every sub-PR that touches `packages/movehat/src/**`, `bin/**`, or published templates. Report results explicitly in the PR description (`pass` / `fail` / `skip-with-reason`).

- **`pnpm test:example`** — mocha against `examples/counter-example/tests/` using the workspace symlink. ~90s. Requires Movement CLI installed locally; some tests need `PRIVATE_KEY` for testnet flows. Verifies that the public API behaves the way the example expects when wired through `workspace:*`.

- **`pnpm test:smoke`** — packs movehat into a tarball, installs it globally, exercises `movehat --version` / `--help` / `init`. ~20s. Catches packaging issues that the workspace symlink hides: missing files in `dist/`, missing `bin` shim, missing template files. Mandatory because Tier 1 cannot see "what's actually in the tarball" — only what's in the workspace.

- **Mandatory end-to-end execution of canonical template scripts** — Any PR that adds or modifies a file under `packages/movehat/src/templates/scripts/**` MUST be exercised end-to-end via `pnpm test:e2e:quick` before merge. The script in `scripts/e2e-local.sh` runs `MOVEHAT_NETWORK=testnet movehat run scripts/deploy-counter.ts` from a freshly-initialized project and asserts the script reaches its terminal "Counter value: 1" line. Type-validity is necessary but not sufficient: the script must actually run successfully against a real Movement node, with assertions on its observable output. This rule exists because a `deploy-counter.ts` template shipped with a runtime-breaking missing-init bug despite passing all unit tests and Tier 1 typecheck — caught only on a user smoke test of the canonical happy path.

- **`pnpm assert-backend`** — backend-assertion gate. Drives the auto-spawn path (a probe that calls `setupTestFixture` without a `localNode`) and fails if the wrong local-test backend started or the fixture took too long. Run both modes for PRs that touch the backend-selection logic (`setupLocalTesting.ts`, `MoveliteManager.ts`, `Publisher.ts`): `MOVEHAT_EXPECT_BACKEND=movelite pnpm assert-backend` (needs the movelite binary — true on macOS arm64 today) and `MOVEHAT_EXPECT_BACKEND=movement-node pnpm assert-backend`. Guards the 0.2.8 fast-boot promise against a silent regression to the slow Movement node. Deferred from CI for now: movelite-expected enters CI once `movelite-linux-x64` is published; movement-node-expected once the Linux MintFunder issue is resolved (`ci.yml` skips the local node on Linux).

What Tier 2 still doesn't cover: the end-to-end install-then-use flow against the published artifact (e.g. would `pnpm install movehat` followed by `movehat compile` + `mocha tests/*` actually work?). That's Tier 3.

### 6.3 Tier 3 — Full install-experience E2E (slow, before publish or develop→main batch)

- **`pnpm test:e2e`** — packs movehat, installs globally, runs `movehat init`, `movehat test --move`, `movehat fork create/list`. ~60s. Drives the real new-user install flow. `--quick` mode skips the slow Move + fork steps and is roughly equivalent to `test:smoke`.

- Wired into `scripts/pre-publish.sh`: `npm publish` is gated on `test:e2e` succeeding. Don't bypass this — it's the last chance to catch packaging regressions before the artifact reaches end users.

- Also mandatory before any `develop → main` batch merge that ships a milestone. The PR that opens the batch must report a `test:e2e` pass; if it fails, the regression lands as its own sub-PR before the batch.

### 6.4 Docs sync — README + packages/docs/ track the example

The example is the *source of truth* for what a user sees. The README and `packages/docs/content/docs/` are derived views of the same shape — they describe what the example demonstrates. When a sub-PR changes the example (because the public surface changed), the same PR must:

- Update any code snippet in `README.md` that quoted the now-changed surface.
- Update any matching MDX page in `packages/docs/content/docs/{getting-started,guides,cli}/` that references the renamed / restructured API.
- If the change is large enough that several MDX files drift, open a follow-up "docs sync" sub-PR (referenced in the original PR) rather than letting the rest of the work block on it. Never let docs go stale silently.

Auto-generated docs (TypeDoc) are M5 work; until then this sync is manual and the responsibility falls on the author of the breaking sub-PR.

### 6.5 Summary of the loop

```
movehat/src/*  →  example uses it  →  README + docs describe it
       ↑                ↑                          ↑
   Tier 1               Tier 2 + 3                 │
   (auto pre-push)      (manual per-PR & pre-pub)  │
                                                   │
       └─────────── manual review per PR ──────────┘
```

If a sub-PR breaks the example, fix it in the same sub-PR. The example is part of the entregable, not a separate concern. CI enforcement of Tier 2 / Tier 3 is M4 work; auto-generated docs are M5; until then Tier 1 is mechanical (pre-push hook) and Tiers 2 + 3 are honor-system but mandatory, recorded explicitly in the PR description.

## 7. Keep ROADMAP.md in Sync with Reality

**Every sub-PR that lands a roadmap milestone item must update `ROADMAP.md` in the same PR — never in a follow-up.**

The rule:

- Tick off `- [ ]` → `- [x]` for every DoD bullet the PR satisfies. If a bullet is partially satisfied (e.g. "M1.4 finishes the rest"), annotate inline with the dependent sub-issue rather than leaving it ambiguous.
- Update the milestone's sub-PR table:
  - Add a `✅` to the Status column when the row's work merges.
  - Append the shipped PR number to the row (e.g. `(shipped in PR #87)`).
  - If a milestone got split mid-flight into sub-PRs (e.g. M1.3 → M1.3a + M1.3b + M1.3c), record the split in the table when the split is decided, not after.
- Update the milestone header line itself (`### MX — …`) with `— ✅ shipped in PR #N` when every DoD bullet flips to `[x]`. That gives a one-line scan view of milestone-level progress.
- For items mechanically impossible to satisfy (e.g. "CI green" while GitHub Actions are paused), use `[N/A]` plus a one-line reason rather than leaving them unchecked indefinitely.

Why this matters: without this rule, the ROADMAP drifts from reality. M0 + M1.1 + M1.2 + M1.3a shipped before this rule was written, and every DoD bullet for those milestones was still `- [ ]` weeks later — making the ROADMAP useless as a status view and forcing readers to cross-reference issues and PR titles to know what's done.

How to apply: when finalizing a sub-PR (before pushing), grep the ROADMAP for the milestone you just touched, and check off every bullet the PR satisfies. If you're unsure whether a bullet is satisfied, ask in the PR description rather than guessing.

### Milestone closeout (separate PR after batch merge)

After a `develop → main` batch PR merges, open a follow-on `docs/MN-roadmap-status` PR targeting `develop`:

- Flip the milestone header line from `### MN — …` to `### MN — ✅ shipped in PR #<batch> (develop → main batch) — …`.
- Add the sub-PR + commit-hash table inside the milestone section: columns `| Sub | Description | PR | Commit |` — mirrors the precedent set by M3 (PR #142 / commit `d8bafac`) and M4 (PR #151 / commit `0568049`).
- List any follow-up issues filed during the milestone with a one-line "deferred to MN+1" rationale.
- No code, no test, no CI changes. Pure ROADMAP edit.

Why a separate PR from the batch itself: the batch is the change-set; the closeout is the post-mortem. Mixing them makes the batch diff harder to review (status flips bury inside hundreds of code-diff lines) and the milestone status harder to find via `git log --grep`.

## 8. Self-Review Before Merge — Unconditional

**Every PR gets a structured self-review before `gh pr merge` runs. No exceptions — including pure-docs PRs, one-line fixes, single-file edits, and PRs the author is confident about.**

**Pre-merge checklist** (from #148 Major #1 — verify each item before `gh pr merge`):

- [ ] §8 self-review posted as a `gh pr review --comment` by the PR author
- [ ] 🔴 / 🟡 findings resolved on the same branch, OR explicitly deferred in a follow-up resolution comment with rationale
- [ ] Tier 2 / Tier 3 results recorded in the PR body (or `N/A` with reason per §6.2 / §6.3)
- [ ] `gh pr view N --json mergeable --jq .mergeable` returns `MERGEABLE` (not `UNKNOWN` or `CONFLICTING`)

The rule:

- Before calling `gh pr merge N`, post a self-review via `gh pr review N --comment` using the same severity-tiered structure used on prior PRs:
  - 🔴 blockers (correctness, security, broken contracts)
  - 🟡 worth fixing before merge (real concerns, fragile assumptions, deferred-but-noted)
    - **Defer threshold** (from #150 Minor #1): when (a) the fix is ≤5 LoC AND (b) the cost of being wrong is non-zero (i.e. not pure stylistic), apply the fix in the originating PR — don't wait for a second reviewer to agree. The bar "wait until two reviewers flag it" makes the second reviewer pay the cost of catching what should have been fixed on first surface.
  - 🟢 nits (style, naming, polish)
- If the review surfaces **🔴 or 🟡** findings, either fix them on the same branch and post a resolution comment listing what was resolved vs deferred, or explicitly note in the resolution why a 🟡 is being deferred to a follow-up sub-PR.
- Merge happens only after **(a)** review is posted, **(b)** 🟡-or-worse findings are resolved or explicitly deferred with a reason, **(c)** mergeable state is CLEAN, **(d)** install-verification gates from §6.2 / §6.3 have been run (or marked N/A in the PR body with reason).
- Even "pure docs" / "single-line fix" / "obviously trivial" PRs go through this. The 30 seconds of forced re-reading catches dead links, terminology drift, misaligned tables, stale references, and assumption gaps that the author missed precisely because they thought the change was trivial.

Why this matters: PRs #91 (ROADMAP backfill), #93 (install gate doc), and #94 (#86 fix) all merged without a self-review, each rationalized as "small / obvious / pure-docs". The retroactive review of #94 surfaced two real 🟡 items (duplicated derivation between `config.ts` and `runtime.ts:69`; silent `""` fallback in `deriveAccountAddress` masking malformed-key errors) and two 🟢 findings that the author had missed. The discipline is unconditional because the author's confidence is exactly what review is meant to challenge.

How to apply: when ready to merge, the sequence is **always**:
1. `gh pr review N --comment --body "..."` (post structured findings; "no findings, ready to merge" is a valid review body for genuinely trivial PRs, but the re-read still happens).
2. Apply 🟡 fixes if any → push → post resolution comment listing what was addressed and what was deferred. Skip this step entirely if the review surfaced only 🟢 nits or no findings.
3. `gh pr merge N --merge --delete-branch`.

If step 1 is skipped, the merge violates this rule and a retroactive review must be posted on the merged PR plus any follow-up sub-PRs needed.

## 9. Console UX conventions

**Every line that reaches the user's terminal from `packages/movehat/src/` is classified into one of five sources, and each source has a fixed visual treatment.** This rule applies to every PR that touches `src/`.

### The five sources

```
┌─ System (Movehat lifecycle)      → logger.* with semantic prefix
│  ▸ in-progress (cyan)
│  ✔ success     (green)
│  ✖ error       (red)
│  ⚠ warning     (yellow)
│  i info        (blue)
│
├─ Subprocess (movement node, aptos move) → muted gray, hidden by default
│  › <output>    (gray, only with -v)
│  ✖ <stderr>    (red, always shown — real signal)
│
├─ User code (their console.log in tests/ or scripts/)
│                                  → passthrough, no prefix, no styling
│
├─ SDK deprecation warnings        → filter known noise (AIP-80 done in 0.2.2);
│                                     surface real warnings via logger.warning
│
└─ Test framework (mocha reporter) → passthrough; mocha owns its formatting
```

### Hard rules

- **No raw `console.log` / `console.error` / `console.warn` in `packages/movehat/src/` outside `src/ui/`.** Every system message goes through a `logger.*` method. The only exception is intentional subprocess passthrough — and even those route through the verbosity gate described below.
- **No raw subprocess stdout passthrough.** When a child process (`movement`, `aptos move`) emits to stdout, the wrapper must filter:
  - Hide routine chatter unless `isVerbose()` returns true.
  - Always surface lines matching critical signals (`panic`, `fatal`, `address already in use`, `EADDRINUSE`) — the user is never silenced through a real failure.
  - Always surface stderr that is not a benign `WARN`-only line — real signal beats chatter.
  - Pattern to copy: `src/node/LocalNodeManager.ts:147-180` and `src/core/Publisher.ts` (build + publish wrappers).
- **Any operation that empirically takes ≥3s in normal use MUST be wrapped in a spinner.** Use `withSpinner` (`src/ui/spinner.ts:73`) for short labelled ops, or `withTimedSpinner` (`src/ui/spinner.ts:106`) for long ops where the user wants live elapsed-time feedback. Short ops (<3s) use `logger.step` + `logger.success`.
- **Top-level phase boundaries use `logger.phase(title)`.** It renders a `━` rule + indented bold title + `━` rule. Close phases with `logger.success(...)` or `logger.error(...)`. Use `logger.divider()` for a standalone rule between sub-sections of the same phase.

### Verbosity contract

- Default (no flag): quiet mode. System logs + critical subprocess signals only.
- `-v` / `--verbose` global CLI flag: includes subprocess stdout with muted gray `›` prefix.
- `MOVEHAT_VERBOSE=1` env var: equivalent to `-v`, lets shell-script callers opt in before the CLI parses args.
- `NO_COLOR=1` or non-TTY: auto-degrades to plain text via `shouldUseColor()` (`src/ui/colors.ts:13`); spinners auto-disable so piped output stays line-based and parseable by CI.

### Templates exception

Files under `packages/movehat/src/templates/**` are scaffolding that ships to user projects. They use raw `console.log` on purpose — that is the API end-users themselves write in their own scripts and tests. Do not migrate template files to `logger.*`.

### How to apply

Before opening a PR that touches `src/`, run:

```bash
grep -rn "console\.\(log\|error\|warn\)" packages/movehat/src/ \
  --include="*.ts" \
  | grep -v __tests__ \
  | grep -v "src/ui/" \
  | grep -v "src/templates/"
```

Every match must either route through a verbosity gate (subprocess passthrough) or be migrated to `logger.*`. New ad-hoc `console.log("...")` calls are a §9 violation and must be fixed before merge.

## 10. Issue lifecycle — every PR links to an issue, and closes it on merge

**Every PR that ships user-visible behavior — new feature, bug fix, new doc page, new tutorial, new convention — must reference a GitHub issue. Sub-PRs of a milestone link to the per-sub-PR issue from §5; standalone fixes link to the issue that motivated them. The PR body uses GitHub's auto-close keywords (`Closes #N` / `Fixes #N`) so the link is mechanical, not narrative.**

The rule:

- **Before starting work**, grep open issues for the area you're about to touch (`gh issue list --search "<keyword>"`). If an issue exists, your PR closes it. If none exists, file one first — the issue is the durable record of *why* the work happened; the PR is the *how*.
- **Use `Closes #N` (not `Related to #N` or `See #N`) when the PR fully resolves the issue.** Use `Tracks #M` for the meta-issue (per §5). GitHub recognizes both keywords but only `Closes` / `Fixes` / `Resolves` auto-close the linked issue on merge.
- **Auto-close fires on merge to the default branch (`main`).** Because this project uses the `develop → main` batch workflow (§5 + §7), sub-PRs merged to `develop` reference issues with `Closes #N` but **GitHub will not auto-close them until the batch merges to `main`.** This is the system working as intended — the milestone closeout happens atomically with the batch.
- **Manually close the issue when a sub-PR merges to `develop`** if you want the issue tracker to reflect develop's state immediately rather than wait for the batch. Add a comment on the issue referencing the merged sub-PR + the eventual batch PR, then close. This is optional housekeeping; the auto-close on batch merge is the load-bearing path.
- **Meta-issues (per §5)** close when every linked sub-issue closes. The `Tracks #M` reference on each sub-PR + GitHub's "linked issues" UI surfaces the remaining work.

How to apply:

1. **Starting a feature/fix**: `gh issue list --search "<area>"` → either pick the existing issue or file a new one with the DoD shape from §5 (mechanically verifiable bullets, exact file paths, exact grep commands). Branch name should reflect the issue (`m8.4/typedoc-...` style for sub-issues; `fix/issue-NNN-short-summary` for standalone fixes).
2. **PR description**: include `Closes #N` (and `Tracks #M` if there's a meta-issue) on its own line near the bottom of the PR body. The §6.2 / §6.3 tier-2/3 reporting and the §8 self-review live above.
3. **Merge to develop**: the auto-close is deferred until the batch. Optional: manually close the issue with a one-line "shipped in PR #N to develop; auto-close pending develop→main batch" comment.
4. **Develop → main batch**: GitHub fires the auto-close on every `Closes #N` referenced in any commit in the batch. The closeout PR (§7) double-checks by listing every issue closed in the milestone table.

**Audit cadence**: when starting a new milestone, scan open issues for ones that should already be closed — sub-PRs merged to develop in the previous milestone may have closed on the batch but a parallel issue (e.g., one filed mid-flight that wasn't linked via `Closes`) may still be open. Close them with a comment citing the PR that resolved them.

Why this matters: the issue tracker is the durable record of decisions. PRs are the change-set; issues are the *why* + the linked-discussion thread. An open issue that's actually resolved is friction for everyone — new contributors think there's open work, maintainers re-investigate already-decided questions, the auto-generated "open issues" badge on the README misleads users about the project's health.

## 11. CHANGELOG.md — every sub-PR that closes an issue updates `[Unreleased]`

**Every sub-PR that closes an issue (per §10) MUST update `CHANGELOG.md`'s `[Unreleased]` section in the same PR.** The release PR (`release/X.Y.Z`) then moves `[Unreleased]` content into a new `[X.Y.Z] - DATE` section — it does not write entries from scratch.

The rule:

- Categorize each entry under one of: `### Added`, `### Changed`, `### Fixed`, `### Security`, `### Tests`, `### Internal`, `### Deprecated`, `### Removed`, `### Breaking` (the last is pre-1.0 only — see [MAINTENANCE.md](./MAINTENANCE.md) for the SemVer policy).
- Mirror the prose density of existing 0.2.x entries: 2-4 sentences per bullet, with the *why* / context, not just *what*. A reader scanning `npm view movehat` or the file should understand the change without opening the diff.
- Reference the closing issue at the end of the bullet (`Closes #N`).
- Sub-PRs that are pure refactors, internal-test-only, or have zero user-visible effect MAY skip the entry. Document the skip in the PR body so the release PR knows not to look for one.

Why this matters: the prior model (release-PR dredges through commits since the last tag) is fragile — the release author has to recover context they may not have, and entries get lost. The per-PR model keeps the running record accurate so the release PR is a mechanical `[Unreleased]` → `[X.Y.Z] - DATE` rename + `package.json` version bump.

How to apply:

1. When writing a sub-PR that closes an issue, also edit `CHANGELOG.md`: add a bullet under the appropriate `### Section` inside `[Unreleased]`. Create the section header if it doesn't exist yet for this release window.
2. The release PR (`release/X.Y.Z`) opens with a focused diff: the `[Unreleased]` header line becomes `[X.Y.Z] - YYYY-MM-DD` and the `package.json` version bumps. No prose writing — only curation if entries need re-ordering for narrative flow.

Audit cadence: when opening a release PR, grep `[Unreleased]` against the commit log since the last tag (`git log v<prev>..HEAD --oneline`). Discrepancies mean a sub-PR forgot its entry — file a follow-up `docs(changelog):` commit before tagging the release.

This rule was adopted on 2026-05-22 after the post-0.2.6 polish batch (PR #274) shipped without CHANGELOG entries; the backfill PR #275 populated `[Unreleased]` retroactively. `MAINTENANCE.md` was updated in the same change to reflect the new model.

---

## Project-Specific Context

**What is Movehat?** A Hardhat-like development framework for Movement L1 smart contracts. Provides local blockchain testing, compilation, deployment, and testing utilities.

### Package Structure
```
movehat-workspace/
├── packages/
│   ├── movehat/           # Main CLI package (src/cli.ts, src/runtime.ts, src/helpers/)
│   └── docs/              # Fumadocs + Next.js 15 static site (out/)
├── examples/
│   └── counter-example/   # Example project demonstrating usage — the install-experience gate
├── scripts/               # E2E, smoke-test, pre-publish scripts
└── .github/workflows/     # CI: unit tests, E2E, security audit
```

### Key Commands
```bash
pnpm build              # Build all packages
pnpm dev                # Dev mode for movehat CLI
pnpm test               # Unit tests (movehat package)
pnpm test:e2e           # E2E tests (requires Movement CLI tarball)
pnpm test:watch         # Watch mode for tests
pnpm test:coverage      # Coverage report (target 80%)
pnpm test:example       # Run examples/counter-example mocha suite
pnpm test:smoke         # Pack + global install + CLI smoke checks
pnpm build:docs         # Build static docs site → out/
pnpm dev:docs           # Dev server for docs
```

### Important Conventions

**Dual Testing Modes:**
- `local-node` — Full local blockchain (auto-starts node, funds accounts, deploys contracts)
- `fork` — Read-only snapshot of remote network state

**Test Fixture Pattern:**
```typescript
const fixture = await setupTestFixture(['counter'] as const, ['alice', 'bob']);
fixture.contracts.counter.call(deployer, "increment", []);
fixture.contracts.counter.view<string>("get", [deployer.accountAddress.toString()]);
```

**Named Addresses:** Auto-detected from Move source; use directly without manual address resolution.

**Coverage gates:** global ≥70% lines, per-file ≥80% on 16 critical modules (configured in `packages/movehat/vitest.config.ts`). Reports in `packages/movehat/coverage/` (HTML at `coverage/index.html`).

### Docs Site
- **Framework:** Fumadocs v15 + Next.js 15 with `output: 'export'` (static)
- **Important:** Do NOT use fumadocs-core/ui v16+ with Next.js 15 — requires `useEffectEvent` which only works with Next.js 16
- **Import workaround:** Use `import { docs } from '../.source/server'` instead of `fumadocs-mdx:collections/server`
- **Content:** `packages/docs/content/docs/`

### CI Workflow
- **Unit tests:** On all PRs, Node 20/22, global coverage threshold 70%
- **E2E tests:** On all PRs, downloads Movement CLI tarball with SHA256 pin
- **Security audit:** Runs on PRs

### Key Files (for reference)
| File | Purpose |
|------|---------|
| `src/cli.ts` | Commander CLI entry point |
| `src/runtime.ts` | Runtime (`getMovehat()`, `mh`) |
| `src/helpers/index.ts` | `setupTestFixture`, `setupLocalTesting` |
| `src/core/contract.ts` | `MoveContract` class |
| `src/core/AccountManager.ts` | Account generation/funding |
| `src/core/deployments.ts` | Deployment tracking |
| `src/utils/childProcessAdapter.ts` | Injectable spawn abstraction (M1.1) |
| `src/utils/runCli.ts` | CLI wrapper with stderr redaction (M1.1) |
| `src/utils/address.ts` | Address normalization helpers (M1.1) |

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
