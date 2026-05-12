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

## 8. Self-Review Before Merge — Unconditional

**Every PR gets a structured self-review before `gh pr merge` runs. No exceptions — including pure-docs PRs, one-line fixes, single-file edits, and PRs the author is confident about.**

The rule:

- Before calling `gh pr merge N`, post a self-review via `gh pr review N --comment` using the same severity-tiered structure used on prior PRs:
  - 🔴 blockers (correctness, security, broken contracts)
  - 🟡 worth fixing before merge (real concerns, fragile assumptions, deferred-but-noted)
  - 🟢 nits (style, naming, polish)
- If the review surfaces **🔴 or 🟡** findings, either fix them on the same branch and post a resolution comment listing what was resolved vs deferred, or explicitly note in the resolution why a 🟡 is being deferred to a follow-up sub-PR.
- Merge happens only after **(a)** review is posted, **(b)** 🟡-or-worse findings are resolved or explicitly deferred with a reason, **(c)** mergeable state is CLEAN.
- Even "pure docs" / "single-line fix" / "obviously trivial" PRs go through this. The 30 seconds of forced re-reading catches dead links, terminology drift, misaligned tables, stale references, and assumption gaps that the author missed precisely because they thought the change was trivial.

Why this matters: PRs #91 (ROADMAP backfill), #93 (install gate doc), and #94 (#86 fix) all merged without a self-review, each rationalized as "small / obvious / pure-docs". The retroactive review of #94 surfaced two real 🟡 items (duplicated derivation between `config.ts` and `runtime.ts:69`; silent `""` fallback in `deriveAccountAddress` masking malformed-key errors) and two 🟢 findings that the author had missed. The discipline is unconditional because the author's confidence is exactly what review is meant to challenge.

How to apply: when ready to merge, the sequence is **always**:
1. `gh pr review N --comment --body "..."` (post structured findings; "no findings, ready to merge" is a valid review body for genuinely trivial PRs, but the re-read still happens).
2. Apply 🟡 fixes if any → push → post resolution comment.
3. `gh pr merge N --merge --delete-branch`.

If step 1 is skipped, the merge violates this rule and a retroactive review must be posted on the merged PR plus any follow-up sub-PRs needed.

---

## Project-Specific Context

**What is Movehat?** A Hardhat-like development framework for Movement L1 and Aptos Move smart contracts. Provides local blockchain testing, compilation, deployment, and testing utilities.

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

**Coverage Target:** 80% (currently ~15%)

### Docs Site
- **Framework:** Fumadocs v15 + Next.js 15 with `output: 'export'` (static)
- **Important:** Do NOT use fumadocs-core/ui v16+ with Next.js 15 — requires `useEffectEvent` which only works with Next.js 16
- **Import workaround:** Use `import { docs } from '../.source/server'` instead of `fumadocs-mdx:collections/server`
- **Content:** `packages/docs/content/docs/`

### CI Workflow
- **Unit tests:** On all PRs, Node 20/22, coverage threshold 15%
- **E2E tests:** PRs to main only, downloads Movement CLI tarball
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
