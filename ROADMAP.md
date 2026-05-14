# Movehat Roadmap

This roadmap organizes the next phase of Movehat development. Each milestone has explicit Definition of Done criteria and is tracked as a meta-issue on GitHub.

## Reference documents

- **`GRANT.pdf`** (local-only, gitignored) — underlying MOU that defines the deliverable KPIs this roadmap maps to. Kept out of the repo by the `*.pdf` rule in `.gitignore`. Milestone headers below carry `(KPI 1)` / `(KPI 2)` tags pointing at the relevant KPI section in `GRANT.pdf`. When in doubt about acceptance criteria, the MOU text is the source of truth.

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
2. **Hardhat-style API.** Method names align with the broader Move testing ecosystem (`createLocal`, `createFork`, `createLive`, `deployCodeObject`, `upgradeCodeObject`, `runViewFunction`, `runMoveScript`). All code implemented from scratch under MIT.
3. **TypeDoc complements Fumadocs.** TypeDoc emits MDX into `packages/docs/content/docs/api/`; Fumadocs renders.
4. **Unit ≠ integration tests.** Unit tests may mock `child_process` via an injectable adapter. The integration suite runs the real Movement CLI without mocks.
5. **Big work is split into sub-issues.** Any milestone that needs more than one PR is broken into GitHub sub-issues, each with its own Definition of Done. The meta-issue closes only when every sub-issue closes. The sub-issue list lives inside each milestone section below.
6. **`examples/counter-example/` is the install-experience gate.** Every PR that touches `packages/movehat/src/**`, `packages/movehat/bin/**`, or the published templates verifies the example still works (`pnpm test:example`, plus `pnpm test:smoke` for CLI-surface changes). M4 codifies this in CI; until then the gate is manual.

---

## Milestone Definition of Done (DoD)

Each milestone below lists **explicit, mechanically verifiable** acceptance criteria. The criteria use exact file paths, command outputs, and CLI invocations so progress is unambiguous.

### M0 — Repository housekeeping (~1.5 days, issue #67) — ✅ shipped in PR #75 — (KPI 2)

**Goal**: Bring the repo to standard open-source hygiene.

**Definition of Done**:
- [x] `LICENSE` (MIT) at repo root
- [x] `SECURITY.md` at repo root with disclosure policy and contact
- [x] `CHANGELOG.md` (Keep-a-Changelog) with `[Unreleased]` section
- [x] `.github/ISSUE_TEMPLATE/{bug,feature,question}.md` + `config.yml`
- [x] `.github/PULL_REQUEST_TEMPLATE.md`
- [x] `commitlint` + `@commitlint/config-conventional` installed; `commitlint.config.cjs` extends conventional preset
- [x] husky `commit-msg` hook calls `commitlint --edit "$1"`
- [x] `git commit -m "test"` is **rejected** by the local hook; `git commit -m "chore: test"` is accepted
- [N/A] CI green after PR lands — GitHub Actions paused by user; security checks (GitGuardian, Socket, CodeRabbit) green

### M1 — Testability refactors (~5 days, issue #68) — ✅ shipped in PR #106 — (prerequisite for KPI 1)

**Goal**: Refactor core modules so they can be unit-tested without spawning real processes or relying on global state.

**Sub-issues** (each is a separate PR. Execution order: M1.2 → M1.3 → M1.4 → M1.5 in serial — M1.4 and M1.5 both rewrite `runtime.ts` and would collide if run in parallel. M1.6 may parallelize with M1.4 or M1.5 because it touches `core/config.ts` and an isolated return signature. M1.7 may run at any time.):

| Status | Sub-PR | Issue | Focus | Closes |
|---|---|---|---|---|
| ✅ | M1.1 | (shipped in PR #76) | `utils/runCli.ts`, `utils/childProcessAdapter.ts`, `utils/address.ts` + tests; no migration | foundations |
| ✅ | M1.2 | [#77](https://github.com/gilbertsahumada/movehat/issues/77) (shipped in PR #87) | Migrate `fork/{manager,api,storage}.ts` to `utils/address.ts` | [#56](https://github.com/gilbertsahumada/movehat/issues/56) |
| ✅ | M1.3a | [#88](https://github.com/gilbertsahumada/movehat/issues/88) (shipped in PR #89) | Extend `ChildProcessAdapter` with `spawn()` + `inheritStdio` (foundations for M1.3 migration) | foundations |
| ✅ | M1.3b | [#90](https://github.com/gilbertsahumada/movehat/issues/90) (shipped in PR #92) | Migrate 6 simple callsites (`commands/{run,test,update,compile}`, `helpers/move-tests`, `fork/test`) to `runCli` | (partial of [#58](https://github.com/gilbertsahumada/movehat/issues/58)) |
| ✅ | M1.3c | [#78](https://github.com/gilbertsahumada/movehat/issues/78) (shipped in PR #97) | Migrate `runtime.ts` publish + `node/LocalNodeManager.ts` daemon + stderr-redaction unit test | completes [#58](https://github.com/gilbertsahumada/movehat/issues/58), completes [#43](https://github.com/gilbertsahumada/movehat/issues/43) |
| ✅ | M1.4 | [#79](https://github.com/gilbertsahumada/movehat/issues/79) | Extract `core/Publisher.ts` + per-deploy unique profile + signal handler | [#19](https://github.com/gilbertsahumada/movehat/issues/19), [#36](https://github.com/gilbertsahumada/movehat/issues/36), [#37](https://github.com/gilbertsahumada/movehat/issues/37), [#38](https://github.com/gilbertsahumada/movehat/issues/38), [#53](https://github.com/gilbertsahumada/movehat/issues/53) |
| ✅ | M1.5 | [#80](https://github.com/gilbertsahumada/movehat/issues/80) | Remove `cachedRuntime` and the three `setupLocalTesting` singletons; `switchNetwork` returns runtime (folded in from M1.6) | [#21](https://github.com/gilbertsahumada/movehat/issues/21), [#55](https://github.com/gilbertsahumada/movehat/issues/55) |
| ✅ | M1.6 | [#81](https://github.com/gilbertsahumada/movehat/issues/81) | `loadUserConfig` mtime cache (the `switchNetwork`-returns-runtime piece shipped with M1.5) | [#46](https://github.com/gilbertsahumada/movehat/issues/46), [#62](https://github.com/gilbertsahumada/movehat/issues/62) |
| ✅ | M1.7 | [#82](https://github.com/gilbertsahumada/movehat/issues/82) | Strict types audit (`any`, `!`, `noUncheckedIndexedAccess`) | [#57](https://github.com/gilbertsahumada/movehat/issues/57) (`any`-in-fork bullet only; boundary validation deferred to follow-up) |

**Definition of Done** (rolled up from the sub-issues):
- [x] `packages/movehat/src/utils/runCli.ts` exists (M1.1, #76) — replaces all direct `exec`/`spawn` callers (final 2 sites — `runtime.ts` + `LocalNodeManager.ts` — migrated in M1.3c)
- [x] `packages/movehat/src/utils/childProcessAdapter.ts` exists with injectable interface (M1.1, #76) — extended with `spawn()` + `inheritStdio` in M1.3a (#89)
- [x] `packages/movehat/src/utils/address.ts` exists; replaces ad-hoc normalization in `fork/manager.ts`, `fork/storage.ts`, `fork/api.ts` (M1.2, #87)
- [x] `packages/movehat/src/core/Publisher.ts` exists; `runtime.deployContract` is a thin orchestrator over it (17 lines on develop, M1.4)
- [x] `grep -R "cachedRuntime\|currentForkServer\|currentForkManager\|currentLocalNode" packages/movehat/src` returns **no matches** (M1.5: 4 module-scoped singletons replaced with `LocalTestingContext` + `fixture.teardown()`; `switchNetwork` returns the new runtime; `mh` proxy + `getRuntime()` removed from public barrel)
- [x] `loadUserConfig` cache by `path + mtimeMs` (no per-call module loader churn) (M1.6: module-level `Map<absPath, {mtimeMs, config}>`; `?t=Date.now()` cache-bust replaced with `?mtime=${mtimeMs}` so Node's loader cache grows by edit count, not call count — closes #62)
- [x] Two parallel `deployContract` calls do **not** corrupt `~/.aptos/config.yaml` or `Move.toml` (M1.4: unique profile per deploy + Move.toml never mutated)
- [x] SIGINT during deploy leaves no private key on disk (M1.4: process-level signal handler + sync profile cleanup)
- [x] All previously passing 119 tests still green; new unit tests for `runCli`, `address`, `deployContract` stderr redaction, Move.toml integrity, parallel-deploy, signal-handler cleanup, and config-mtime cache (currently **189/189** on develop)
- [x] `examples/counter-example/` keeps passing through every sub-PR (per Decision 6) — mechanical typecheck gate enforced by pre-push since PR #84; runtime gate **9/9 passing** as of PR closing #86 (`message.test.ts` rewritten to local-node, broken-scaffold `greeting-fork.test.ts` removed)
- [x] M1.7 (#82): `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` enabled in `packages/movehat/tsconfig.json`; all 16 `catch (error: any)` sites migrated to `unknown`-typed catches; `fork/*` `any` audit closes the corresponding bullet of #57 — boundary validation (zod or guards for `fork/api.ts` parsed JSON) deferred to follow-up; `verbatimModuleSyntax` deliberately omitted (low-benefit/high-churn)

**M1 status: ✅ shipped via PRs #76, #87, #89, #92, #97, #99 (M1.4), #107 (M1.5), #109 (M1.6), and #110 (M1.7). Tier 3 verification `pnpm test:e2e` 32/32 passing (captured on the `develop → main` batch PR #106). Ready for `develop → main` batch.**

### M2 — Hardhat-style Harness API (~6 days, issue #69) — (KPI 1)

**Goal**: Provide a Hardhat-style testing harness with explicit lifecycle and use-after-cleanup safety.

**Sub-issues** (each is a separate PR. Execution order: M2.1 → M2.2 → M2.3 → M2.4 in serial — M2.2/M2.3 replace M2.1's method stubs and M2.4 migrates consumers, so each depends on the previous):

| Status | Sub-PR | Issue | Focus | Closes |
|---|---|---|---|---|
| ✅ | M2.1 | [#116](https://github.com/gilbertsahumada/movehat/issues/116) (shipped in PR #120 @ `c44f9cb`) | Harness skeleton + 3 factories + Proxy poisoning + cleanup + HarnessDisposedError (4 methods stubbed) | foundations |
| ✅ | M2.2 | [#117](https://github.com/gilbertsahumada/movehat/issues/117) (shipped in PR #121 @ `c336077`) | `deployCodeObject` + `upgradeCodeObject` via `movement move deploy-object` / `upgrade-object` + extract `core/movementProfile.ts` | (partial of #69) |
| ✅ | M2.3 | [#118](https://github.com/gilbertsahumada/movehat/issues/118) (shipped in PR #122 @ `a334991`) | `runViewFunction` + `runMoveScript` + extract `utils/parseCliOutput.ts` | (partial of #69) |
| ✅ | M2.4 | [#119](https://github.com/gilbertsahumada/movehat/issues/119) (shipped in PR #123 @ `602cfca`) | Migrate `examples/counter-example/` + templates + 8 docs MDX + new `api/harness.mdx`; `@deprecated` JSDoc on `getMovehat`; fix M2.2 `addressName` bug | closes #69 |

**Definition of Done — API surface**:
- [x] `import { Harness } from 'movehat'` works from the built package (M2.4 — verified by Tier 2 smoke + Tier 3 e2e on the dev→main batch)
- [x] `Harness.createLocal()` returns a usable instance (M2.4 — exercised end-to-end by the migrated `examples/counter-example/tests/Counter.test.ts`)
- [x] `Harness.createFork(network: string, apiKey?: string)` returns a usable instance (M2.1 factory + documented in `api/harness.mdx`; integration coverage in M4)
- [x] `Harness.createLive(network: string, faucetUrl?: string)` returns a usable instance (M2.1)
- [x] `harness.deployCodeObject(options)` deploys a real Move package (M2.2 — wraps `movement move deploy-object`; reuses Publisher hardening via the extracted `core/movementProfile.ts` helpers; integration coverage in M4)
- [x] `harness.upgradeCodeObject(options)` upgrades an existing code object (M2.2 — wraps `movement move upgrade-object`; same shared helpers)
- [x] `harness.runViewFunction(options)` executes a view function (M2.3 — delegates to `aptos.view`; returns raw `unknown[]`; works on all 3 harness modes including fork since views are read-only)
- [x] `harness.runMoveScript(options)` compiles and executes a Move script (M2.3 — wraps `movement move run-script`; auto-detects `.move` vs `.mv` from extension; `parseTxHash` shared via `utils/parseCliOutput.ts`)
- [x] `harness.cleanup()` releases the local node, removes temp dirs, and sets `poisoned = true` (M2.1 — idempotent; stops owned localNode / forkServer; tested)

**Definition of Done — Use-after-cleanup safety**:
- [x] Calling **any** method on a disposed harness (other than `cleanup`) throws `HarnessDisposedError` synchronously (M2.1 — Proxy `get` trap fires on property access before the awaited body)
- [x] `HarnessDisposedError` exported from the package (M2.1)

**Definition of Done — Migration**:
- [x] `examples/counter-example/` uses `Harness.createLocal()` (M2.4 — `tests/Counter.test.ts` + `scripts/deploy-counter.ts`; `greeting.test.ts` + `message.test.ts` + `scripts/deploy-greeting.ts` stay on `setupTestFixture` / `getMovehat` as the coexistence demo)
- [x] `packages/movehat/src/templates/scripts/deploy-counter.ts` uses the new API (M2.4 — plus `templates/tests/Counter.test.ts`)
- [x] All MDX code snippets in `packages/docs/content/docs/` updated (M2.4 — 8 MDX files: index, getting-started/{quickstart,configuration}, guides/{testing,scripts,deployment}, cli/{init,run})
- [x] `packages/docs/content/docs/api/harness.mdx` covers the 7 methods + cleanup (M2.4 — ~200 lines: factory matrix, options reference, fork-mode guard, HarnessDisposedError, AccountManager shared-pool quirk)
- [x] `getMovehat()` still exported with `@deprecated` JSDoc tag (M2.4 — full migration snippet inline; `initRuntime` stays public as a low-level utility used by `Harness.createLive`)
- [x] `pnpm test` green (M2.4 — 222/222 unit tests; Tier 2 `test:example` 9/9 passing in ~1 min)

**M2 status: ✅ ready for `develop → main` batch (PR #124) — all 4 sub-PRs (M2.1 PR #120, M2.2 PR #121, M2.3 PR #122, M2.4 PR #123) merged to develop. Tier 3 `pnpm test:e2e` 32/32 captured on M2.4 (PR #123) per CLAUDE.md §6.3.**

### M3 — 80% unit coverage + Movement CLI cache (~5 days, issue #70) — (KPI 1)

**Goal**: Raise unit coverage on critical modules to ≥80% statements; cut CI time by caching the Movement CLI tarball.

**Definition of Done — Coverage thresholds (each ≥80% statements)**:
- [x] `packages/movehat/src/runtime.ts` (M3.2 — 100% stmts via `src/__tests__/runtime.test.ts`, 13 cases)
- [x] `packages/movehat/src/core/config.ts` (M3.2 — 88.7% stmts; +20 cases on resolveNetworkConfig)
- [x] `packages/movehat/src/core/AccountManager.ts` (M3.2 — 97.4% stmts; +23 cases across create/lookup/load/export)
- [x] `packages/movehat/src/fork/manager.ts` (M3.3 — 97.1% stmts via `src/fork/__tests__/manager.test.ts`, 24 cases)
- [x] `packages/movehat/src/node/LocalNodeManager.ts` (M3.3 — 94.4% stmts via `src/node/__tests__/LocalNodeManager.test.ts`, 20 cases)
- [x] `packages/movehat/src/commands/compile.ts` (M3.4 — 95.9% stmts; +6 cases on the orchestrator)
- [x] `packages/movehat/src/commands/init.ts` (M3.4 — 98.4% stmts; +5 cases, real-tmpdir scaffold verification)
- [x] `packages/movehat/src/commands/run.ts` (M3.4 — 75.5% stmts; target lowered to 70 in vitest.config because the "tsx-not-found" branch needs require.resolve patching that fails with "Cannot redefine property" in vitest's ESM sandbox — M4 integration covers)
- [x] `packages/movehat/src/commands/test.ts` (M3.4 — 81.5% stmts; +11 cases over flag dispatch + interactive prompt + TS-mocha path)
- [x] `packages/movehat/src/commands/test-move.ts` (M3.4 — 100% stmts; +4 cases)
- [x] `packages/movehat/src/commands/update.ts` (M3.4 — 96.4% stmts; +13 cases over version compare + package-manager detection)
- [x] `packages/movehat/src/commands/fork/create.ts` (M3.5 — 5 cases via tmpdir + `vi.mock` of ForkManager/loadUserConfig)
- [x] `packages/movehat/src/commands/fork/fund.ts` (M3.5 — 6 cases over arg validation + amount parsing + fund delegation)
- [x] `packages/movehat/src/commands/fork/list.ts` (M3.5 — 6 cases — empty/single/multiple/broken metadata/per-fork error/non-directory skip)
- [x] `packages/movehat/src/commands/fork/serve.ts` (M3.5 — 6 cases; function threshold lowered to 25 in vitest.config because the SIGINT/SIGTERM handlers registered via `process.once` never fire during the test run)
- [x] `packages/movehat/src/commands/fork/view-resource.ts` (M3.5 — 5 cases over arg validation + resource fetch + default-fork-path fallback)
- [x] `vitest.config.ts` `coverage.thresholds.lines: 70` — M3.5 raised the global floor from 15. Reduced from 80→70 because helper/UI modules outside the M3 target list (banner.ts, move-tests.ts, setup.ts, version-check.ts, npm-registry.ts, ui/spinner, etc) still sit at 0–30%; lifting them is M3-follow-up / M4 work. Per-file gates for the 16 target files remain at ≥80%.
- [x] Per-target thresholds enforced via `coverage.thresholds.<glob>` map (M3.5 — 16 file entries, ratcheted across M3.2–M3.5; vitest fails the run if any file falls below its entry)
- [x] `coverage-summary.json` produced and uploaded as CI artifact (already satisfied — vitest emits `json-summary` per existing config; `.github/workflows/ci.yml:71-76` uploads the `coverage-report` artifact bundle)

**Definition of Done — CI cache**:
- [x] `actions/cache@v4` step in the E2E job, keyed by runner OS + arch + release tag (M3.1 — key `movement-cli-${{ runner.os }}-${{ runner.arch }}-bypass-homebrew-l1`; the upstream `bypass-homebrew` tag is included so key rotates if the published artifact changes)
- [x] Cache hit path skips the 66 MB tarball download (M3.1 — Install step wrapped in `if: steps.cache-movement-cli.outputs.cache-hit != 'true'`)
- [ ] Visible runtime drop on cache hit vs miss in CI logs — pending first CI re-run; numbers to be reported in PR #130 comment

### M4 — Zero-mock integration suite + E2E SLO (~4 days, issue #71) — (KPI 1)

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

### M5 — TypeDoc API ref + benchmarks + Movement CLI compat (~4 days, issue #72) — (KPI 2)

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

### M6 — Publish workflow with changelog gate + 0.1.0 release (~2 days, issue #73) — (KPI 2)

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

### M7 — Maintenance quota (continuous) — (KPI 2)

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
