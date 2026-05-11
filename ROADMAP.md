# Movehat Roadmap

This roadmap organizes the next phase of Movehat development. Each milestone has explicit Definition of Done criteria and is tracked as a meta-issue on GitHub.

## Current state

- Documentation site shipped (Fumadocs + Next.js, static export)
- Security baseline shipped (ForkServer bound to `127.0.0.1` by default; account pool stored with `0o600` permissions)
- 119 unit tests passing across 9 test files
- Line coverage: ~15% (CI gate temporarily set to 15%; target is 80%)
- 26 audit issues open ([#36](https://github.com/gilbertsahumada/movehat/issues/36) through [#64](https://github.com/gilbertsahumada/movehat/issues/64))

## Goals

1. Provide a Hardhat-style testing harness with explicit lifecycle and use-after-cleanup safety.
2. Reach **80%+ unit-test coverage** on critical modules.
3. Build a **zero-mock integration suite** that drives the real Movement CLI end-to-end.
4. Auto-generate API documentation, publish performance benchmarks, and ship a release pipeline.
5. Address open audit issues, with the criticals bound to specific milestones.

## Decisions

1. **`Harness` deprecates `mh()`.** Pre-1.0 (`0.0.0-dev`), no external consumers. The new `Harness` class becomes the primary public API. `mh()` is `@deprecated` from M2 and removed in M6 with the bump to 0.1.0.
2. **Hardhat-style API.** Method names align with the broader Move/Aptos testing ecosystem (`createLocal`, `createFork`, `createLive`, `deployCodeObject`, `upgradeCodeObject`, `runViewFunction`, `runMoveScript`). All code implemented from scratch under MIT.
3. **TypeDoc complements Fumadocs.** TypeDoc emits MDX into `packages/docs/content/docs/api/`; Fumadocs renders.
4. **Unit ≠ integration tests.** Unit tests may mock `child_process` via an injectable adapter. The integration suite runs the real Movement CLI without mocks.
5. **Big work is split into sub-issues.** Any milestone that needs more than one PR is broken into GitHub sub-issues, each with its own Definition of Done. The meta-issue closes only when every sub-issue closes. The sub-issue list lives inside each milestone section below.
6. **`examples/counter-example/` is the install-experience gate.** Every PR that touches `packages/movehat/src/**`, `packages/movehat/bin/**`, or the published templates verifies the example still works (`pnpm test:example`, plus `pnpm test:smoke` for CLI-surface changes). M4 codifies this in CI; until then the gate is manual.

---

## Milestone Definition of Done (DoD)

Each milestone below lists **explicit, mechanically verifiable** acceptance criteria. The criteria use exact file paths, command outputs, and CLI invocations so progress is unambiguous.

### M0 — Repository housekeeping (~1.5 days, issue #67)

**Goal**: Bring the repo to standard open-source hygiene.

**Definition of Done**:
- [ ] `LICENSE` (MIT) at repo root
- [ ] `SECURITY.md` at repo root with disclosure policy and contact
- [ ] `CHANGELOG.md` (Keep-a-Changelog) with `[Unreleased]` section
- [ ] `.github/ISSUE_TEMPLATE/{bug,feature,question}.md` + `config.yml`
- [ ] `.github/PULL_REQUEST_TEMPLATE.md`
- [ ] `commitlint` + `@commitlint/config-conventional` installed; `commitlint.config.js` extends conventional preset
- [ ] husky `commit-msg` hook calls `commitlint --edit "$1"`
- [ ] `git commit -m "test"` is **rejected** by the local hook; `git commit -m "chore: test"` is accepted
- [ ] CI green after PR lands

### M1 — Testability refactors (~5 days, issue #68)

**Goal**: Refactor core modules so they can be unit-tested without spawning real processes or relying on global state.

**Sub-issues** (each is a separate PR, executed in order; M1.4 may parallelize with M1.5/M1.6 once M1.3 lands):

| Sub-PR | Issue | Focus | Closes |
|--------|-------|-------|--------|
| **M1.1** | (shipped in PR #76) | `utils/runCli.ts`, `utils/childProcessAdapter.ts`, `utils/address.ts` + tests; no migration | foundations |
| M1.2 | [#77](https://github.com/gilbertsahumada/movehat/issues/77) | Migrate `fork/{manager,api,storage}.ts` to `utils/address.ts` | [#56](https://github.com/gilbertsahumada/movehat/issues/56) |
| M1.3 | [#78](https://github.com/gilbertsahumada/movehat/issues/78) | Migrate the 8 `exec`/`spawn` callsites to `runCli` | [#58](https://github.com/gilbertsahumada/movehat/issues/58), completes [#43](https://github.com/gilbertsahumada/movehat/issues/43) |
| M1.4 | [#79](https://github.com/gilbertsahumada/movehat/issues/79) | Extract `core/Publisher.ts` + per-deploy temp dir + SIGINT handler | [#19](https://github.com/gilbertsahumada/movehat/issues/19), [#36](https://github.com/gilbertsahumada/movehat/issues/36), [#37](https://github.com/gilbertsahumada/movehat/issues/37), [#38](https://github.com/gilbertsahumada/movehat/issues/38), [#53](https://github.com/gilbertsahumada/movehat/issues/53) |
| M1.5 | [#80](https://github.com/gilbertsahumada/movehat/issues/80) | Remove `cachedRuntime` and the three `setupLocalTesting` singletons | [#21](https://github.com/gilbertsahumada/movehat/issues/21), [#55](https://github.com/gilbertsahumada/movehat/issues/55) |
| M1.6 | [#81](https://github.com/gilbertsahumada/movehat/issues/81) | `loadUserConfig` mtime cache + `switchNetwork` returns runtime | [#46](https://github.com/gilbertsahumada/movehat/issues/46), [#62](https://github.com/gilbertsahumada/movehat/issues/62) |
| M1.7 | [#82](https://github.com/gilbertsahumada/movehat/issues/82) | Strict types audit (`any`, `!`, `noUncheckedIndexedAccess`) | [#57](https://github.com/gilbertsahumada/movehat/issues/57) |

**Definition of Done** (rolled up from the sub-issues):
- [ ] `packages/movehat/src/utils/runCli.ts` exists; replaces all direct `exec`/`spawn` callers
- [ ] `packages/movehat/src/utils/childProcessAdapter.ts` exists with injectable interface
- [ ] `packages/movehat/src/utils/address.ts` exists; replaces ad-hoc normalization in `fork/manager.ts`, `fork/storage.ts`, `fork/api.ts`
- [ ] `packages/movehat/src/core/Publisher.ts` exists; `runtime.deployContract` is a thin orchestrator over it
- [ ] `grep -R "cachedRuntime\|currentForkServer\|currentForkManager\|currentLocalNode" packages/movehat/src` returns **no matches**
- [ ] `loadUserConfig` cache by `path + mtimeMs` (no per-call module loader churn)
- [ ] Two parallel `deployContract` calls do **not** corrupt `~/.aptos/config.yaml` or `Move.toml`
- [ ] SIGINT during deploy leaves no private key on disk
- [ ] All previously passing 119 tests still green; new unit tests for `runCli`, `address`, `Publisher`
- [ ] `examples/counter-example/` keeps passing through every sub-PR (per Decision 6)

### M2 — Hardhat-style Harness API (~6 days, issue #69)

**Goal**: Provide a Hardhat-style testing harness with explicit lifecycle and use-after-cleanup safety.

**Definition of Done — API surface**:
- [ ] `import { Harness } from 'movehat'` works from the built package
- [ ] `Harness.createLocal()` returns a usable instance
- [ ] `Harness.createFork(network: string, apiKey?: string)` returns a usable instance
- [ ] `Harness.createLive(network: string, faucetUrl?: string)` returns a usable instance
- [ ] `harness.deployCodeObject(options)` deploys a real Move package
- [ ] `harness.upgradeCodeObject(options)` upgrades an existing code object
- [ ] `harness.runViewFunction(options)` executes a view function
- [ ] `harness.runMoveScript(options)` compiles and executes a Move script
- [ ] `harness.cleanup()` releases the local node, removes temp dirs, and sets `poisoned = true`

**Definition of Done — Use-after-cleanup safety**:
- [ ] Calling **any** method on a disposed harness (other than `cleanup`) throws `HarnessDisposedError` synchronously
- [ ] `HarnessDisposedError` exported from the package

**Definition of Done — Migration**:
- [ ] `examples/counter-example/` uses `Harness.createLocal()`
- [ ] `packages/movehat/src/templates/scripts/deploy-counter.ts` uses the new API
- [ ] All MDX code snippets in `packages/docs/content/docs/` updated
- [ ] `packages/docs/content/docs/api/harness.mdx` covers the 7 methods + cleanup
- [ ] `mh()` still exported with `@deprecated` JSDoc tag
- [ ] `pnpm test` green

### M3 — 80% unit coverage + Movement CLI cache (~5 days, issue #70)

**Goal**: Raise unit coverage on critical modules to ≥80% statements; cut CI time by caching the Movement CLI tarball.

**Definition of Done — Coverage thresholds (each ≥80% statements)**:
- [ ] `packages/movehat/src/runtime.ts`
- [ ] `packages/movehat/src/core/config.ts`
- [ ] `packages/movehat/src/core/AccountManager.ts`
- [ ] `packages/movehat/src/fork/manager.ts`
- [ ] `packages/movehat/src/node/LocalNodeManager.ts`
- [ ] `packages/movehat/src/commands/compile.ts`
- [ ] `packages/movehat/src/commands/init.ts`
- [ ] `packages/movehat/src/commands/run.ts`
- [ ] `packages/movehat/src/commands/test.ts`
- [ ] `packages/movehat/src/commands/test-move.ts`
- [ ] `packages/movehat/src/commands/update.ts`
- [ ] `packages/movehat/src/commands/fork/create.ts`
- [ ] `packages/movehat/src/commands/fork/fund.ts`
- [ ] `packages/movehat/src/commands/fork/list.ts`
- [ ] `packages/movehat/src/commands/fork/serve.ts`
- [ ] `packages/movehat/src/commands/fork/view-resource.ts`
- [ ] Global `vitest.config.ts` `coverage.thresholds.lines: 80` (replaces 15%)
- [ ] Per-target thresholds enforced via `coverage.thresholds.<glob>` map
- [ ] `coverage-summary.json` produced and uploaded as CI artifact

**Definition of Done — CI cache**:
- [ ] `actions/cache@v4` step in the E2E job, keyed by Movement CLI tarball SHA / release URL hash
- [ ] Cache hit path skips the 66 MB tarball download
- [ ] Visible runtime drop on cache hit vs miss in CI logs

### M4 — Zero-mock integration suite + E2E SLO (~4 days, issue #71)

**Goal**: Build an integration suite running real Movement CLI; tighten CI policy.

**Definition of Done — Integration suite**:
- [ ] `packages/movehat/test/integration/` directory exists
- [ ] Suite drives the full Harness flow: `createLocal` → `deployCodeObject` → `runViewFunction` → `upgradeCodeObject` → `runMoveScript` → `cleanup`
- [ ] At least one test path uses `createFork`
- [ ] `grep -r "vi\.mock" packages/movehat/test/integration/` returns **no matches**
- [ ] Suite runs via a separate `vitest.integration.config.ts`
- [ ] `TESTING.md` documents how to run the suite locally and the Docker fallback

**Definition of Done — CI policy**:
- [ ] `.github/workflows/ci.yml` E2E trigger on **every push** (`on: push`), not only on PR to `main`
- [ ] `timeout-minutes: 5` set per job
- [ ] Wall-clock for the E2E job is observed **<5 minutes** on cache hit
- [ ] CI is green on `main` and on at least one non-`main` branch (e.g., a feature/security branch)

### M5 — TypeDoc API ref + benchmarks + Movement CLI compat (~4 days, issue #72)

**Goal**: Auto-generate API reference from source; document fork-system performance and Movement CLI compatibility.

**Definition of Done — Auto-generated docs**:
- [ ] `typedoc` + `typedoc-plugin-markdown` installed
- [ ] `pnpm docs:api` script generates MDX into `packages/docs/content/docs/api/`
- [ ] `packages/docs/package.json` `prebuild` runs the generation step
- [ ] `/api/Harness` (or equivalent) route renders the generated content on the docs site

**Definition of Done — Benchmarks**:
- [ ] `packages/movehat/bench/fork.bench.ts` exists (using `vitest bench` or `tinybench`)
- [ ] Measures cold-start, fork hydrate, RPC round-trip
- [ ] `BENCHMARKS.md` at repo root with baseline numbers
- [ ] At least 1–2 optimization wins applied (e.g., parallel resource fetch); before/after numbers in the same file

**Definition of Done — Compatibility matrix**:
- [ ] `MOVEMENT_CLI_COMPAT.md` at repo root listing tested Movement CLI versions
- [ ] At least 2 versions tested green
- [ ] CI cache key references the pinned version(s)

### M6 — Publish workflow with changelog gate + 0.1.0 release (~2 days, issue #73)

**Goal**: Establish a release pipeline that validates the changelog and publishes to npm.

**Definition of Done — Publish workflow**:
- [ ] `.github/workflows/publish.yml` triggers on `v*` tags
- [ ] Tag without a matching `CHANGELOG.md` section **fails** the workflow
- [ ] Working-tree-clean check passes before publish
- [ ] Unit + integration tests run before publish
- [ ] `npm publish --access public` runs from `packages/movehat`
- [ ] GitHub release created with the `CHANGELOG` section as body

**Definition of Done — `mh()` removal & version bump**:
- [ ] `mh` no longer exported from `packages/movehat/src/index.ts`
- [ ] `packages/movehat/package.json` version bumped to `0.1.0`
- [ ] `npm view movehat@0.1.0` returns the new version after publish
- [ ] `npm pack` output does not contain `mh` exports

### M7 — Maintenance quota (continuous)

**Goal**: Address open audit issues throughout the roadmap.

**Definition of Done**:
- [ ] **≥5 issues** closed from: [#40](https://github.com/gilbertsahumada/movehat/issues/40), [#41](https://github.com/gilbertsahumada/movehat/issues/41), [#42](https://github.com/gilbertsahumada/movehat/issues/42), [#44](https://github.com/gilbertsahumada/movehat/issues/44), [#45](https://github.com/gilbertsahumada/movehat/issues/45), [#47](https://github.com/gilbertsahumada/movehat/issues/47), [#48](https://github.com/gilbertsahumada/movehat/issues/48), [#49](https://github.com/gilbertsahumada/movehat/issues/49), [#50](https://github.com/gilbertsahumada/movehat/issues/50), [#52](https://github.com/gilbertsahumada/movehat/issues/52), [#54](https://github.com/gilbertsahumada/movehat/issues/54), [#59](https://github.com/gilbertsahumada/movehat/issues/59), [#60](https://github.com/gilbertsahumada/movehat/issues/60), [#64](https://github.com/gilbertsahumada/movehat/issues/64)
- [ ] Distributed opportunistically across milestones (e.g., #41 fits naturally in M1, #44 in M0)
- [ ] No critical (`security` + `bug`) audit issues left open at the time of M6

---

## Critical issues bound to milestones

| Audit issue | Milestone |
|---|---|
| [#19](https://github.com/gilbertsahumada/movehat/issues/19) / [#53](https://github.com/gilbertsahumada/movehat/issues/53) Publisher extract | M1 |
| [#21](https://github.com/gilbertsahumada/movehat/issues/21) / [#55](https://github.com/gilbertsahumada/movehat/issues/55) Singletons | M1 |
| [#36](https://github.com/gilbertsahumada/movehat/issues/36) SIGINT key leak | M1 |
| [#37](https://github.com/gilbertsahumada/movehat/issues/37) Race condition | M1 |
| [#38](https://github.com/gilbertsahumada/movehat/issues/38) `Move.toml` mutation | M1 |
| [#43](https://github.com/gilbertsahumada/movehat/issues/43) stderr key leak | M1 |
| [#46](https://github.com/gilbertsahumada/movehat/issues/46) `switchNetwork` return | M1 |
| [#51](https://github.com/gilbertsahumada/movehat/issues/51) txHash regex | M3 |
| [#56](https://github.com/gilbertsahumada/movehat/issues/56) Address utils | M1 |
| [#57](https://github.com/gilbertsahumada/movehat/issues/57) Strict types | M1 |
| [#58](https://github.com/gilbertsahumada/movehat/issues/58) `runCli` helper | M1 |
| [#61](https://github.com/gilbertsahumada/movehat/issues/61) `deployContract` tests | M3 |
| [#62](https://github.com/gilbertsahumada/movehat/issues/62) Config cache leak | M1 |
| [#63](https://github.com/gilbertsahumada/movehat/issues/63) `authentication_key` placeholder | M5 |

## Execution order

```
M0 → M1 → M2 → M3 → M4 → M5 → M6
```

M3 and M4 may parallelize once M2 lands. M5 and M6 may parallelize.

## Risks

1. **`LocalNodeManager` 80% unit coverage** — spawning real processes is not deterministically unit-testable. Mitigation: child-process adapter from M1 enables fakes; M4 integration suite covers real-process behavior.
2. **Movement CLI version drift** — pin in CI cache key; M5 publishes a compatibility matrix; nightly cron runs `latest` non-blocking.
3. **Coverage delta is large** (~15% → 80%) — per-target thresholds let M3 PRs land incrementally.
4. **`mh()` deprecation** — phased: M2 marks deprecated, M6 removes. The bump from `0.0.0-dev` to `0.1.0` signals the breaking change.

## Critical files

- `packages/movehat/src/runtime.ts`
- `packages/movehat/src/index.ts`
- `packages/movehat/src/core/AccountManager.ts`
- `packages/movehat/src/fork/manager.ts`
- `packages/movehat/src/node/LocalNodeManager.ts`
- `packages/movehat/src/helpers/setupLocalTesting.ts`
- `packages/movehat/vitest.config.ts`
- `.github/workflows/ci.yml`
- `packages/docs/package.json`
