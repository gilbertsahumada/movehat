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

## 5. Document Every Change in the Changelog

**Every change must leave a professional trace in `CHANGELOG.md`.**

For every PR, add an entry under `## [Unreleased]` in `CHANGELOG.md` following [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/):

- Pick the correct category: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
- Write **one bullet per user-visible change**, in imperative voice and present tense ("Add X", "Fix Y", "Deprecate Z").
- Describe **what the user sees**, not the implementation. No commit hashes, no file paths, no internal class names unless they are part of the public API.
- Reference the PR or issue at the end of the bullet: `(#75)`.
- Pure internal work (refactors, test-only changes, tooling, formatting) is the **only** exemption — and when in doubt, write an entry anyway. The publish workflow (M6) will block any tag whose CHANGELOG section is missing.

Example:
```
### Added
- `Harness.createLocal()` factory replacing `mh()` for local-node tests (#69).

### Fixed
- Account pool file is created with `0o600` permissions (#65).
```

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
│   └── counter-example/   # Example project demonstrating usage
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

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.