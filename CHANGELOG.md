# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Foundry-style execution traces for `contract.call(...)` on the movelite
  backend. At verbosity level 2 (`-vv`) Movehat prints a decoded list of the
  events a call emitted; at level 3 (`-vvv`) it renders the call tree of your
  own modules (framework `0x1::*` frames and natives filtered out, with their
  events bubbled up to your nearest frame); at level 4 (`-vvvv`) the full tree —
  framework frames, native calls, storage operations, and return values. Aborts
  show the full tree plus the abort code and stack. Per-frame gas is shown in
  internal VM units, distinct from the transaction's octa `gas_used` in the
  footer. Traces are movelite-only (the Movement node does not expose the trace
  endpoint) and opt-in by verbosity, so the default test loop is unaffected. A
  render failure degrades to a warning and never fails a committed transaction.
  A failed trace request surfaces movelite's structured JSON error `message`
  (with `error_code` / `vm_error_code` when present), falling back to raw text
  for older movelite builds. New guide at `guides/traces.mdx`. Closes #318,
  Closes #324.

### Changed

- The global `-v` / `--verbose` flag is now **counted**: repeat it to raise the
  verbosity level (`-v` … `-vvvv` → levels 1–4). Level 1 is unchanged — it
  surfaces subprocess output exactly as before, and `MOVEHAT_VERBOSE=1` remains
  its shorthand. The higher levels are reserved for the forthcoming movelite
  transaction-trace renderer (decoded events at 2, the call tree at 3–4). A new
  `MOVEHAT_VERBOSITY=<0-4>` env var sets the level directly and propagates across
  the spawned test/script subprocess boundary. `isVerbose()` and its callers are
  unaffected. Closes #316.

### Fixed

- Restore tracking of `MAINTENANCE.md`, which was inadvertently untracked
  together with the genuinely-internal process docs during the docs cleanup.
  The README (including the npm-published package README) and the docs site
  point users to `MAINTENANCE.md` for release cadence, SemVer policy, and the
  deprecation window; untracking it left those links dangling. The file's own
  references to the now-private `CLAUDE.md` / `ROADMAP.md` were genericized
  (redirected to `CONTRIBUTING.md` or dropped) so it stands on its own as a
  public document. Remaining citations of the private process docs across
  `CONTRIBUTING.md`, the PR/issue templates, and a few build comments were
  likewise genericized.

### Internal

- Trace transaction types + HTTP client + `MoveContract` wiring (no renderer
  yet). `core/trace/{types,client}.ts` model movelite's `/v1/transactions/trace`
  contract and POST the BCS-signed transaction with `commit=true`. On movelite
  at verbosity level >= 2, `contract.call(...)` now routes through that endpoint
  (a single instrumented execution that also commits) instead of the normal
  submit, preserving the `{hash, success, vm_status}` return shape; on the
  Movement node and below level 2 the existing submit path is unchanged. The
  call tree is rendered in a following change. Closes #317.

- Bump the bundled `movelite` optional dependency from `^0.1.0` to `^0.2.0`.
  The 0.2.0 binary adds the `POST /v1/transactions/trace` endpoint that the
  upcoming Foundry-style trace renderer will consume; bumping the dependency
  makes that endpoint reachable through the published package. No user-visible
  behavior change in this PR — local boot, fallback, and the existing API
  behave identically; the trace renderer lands separately.

## [0.2.9] - 2026-06-01

### Fixed

- movelite auto-deploy now works. The 0.2.8 fast-boot path spawned movelite
  but could not deploy onto it: `autoDeploy` published through the Movement
  CLI (`move publish`), whose REST client cannot consume movelite's responses
  ("Failed to build State from headers due to missing values in response").
  Every `setupTestFixture` against movelite therefore threw `Module "<x>" was
  not deployed`. `Publisher` now publishes via the `@aptos-labs/ts-sdk`
  (`publishPackageTransaction`) when the backend is movelite, and keeps the
  Movement CLI path for real nodes, forks, and testnet. Verified end-to-end:
  deploy + `increment` + `view` returns the expected value through movelite.
  Closes #305.

### Tests

- Backend-assertion gate (`scripts/assert-backend.sh`, `pnpm assert-backend`).
  Drives the auto-spawn path via a dedicated probe and fails if the wrong
  local-test backend started, guarding against a silent regression to the
  slow Movement node while every other gate stays green. The identity check
  (which backend's start line appeared) is the primary guard; a fixture-ready
  time ceiling corroborates it. Closes #302.

## [0.2.8] - 2026-05-30

### Added

- movelite auto-spawn integration. `Harness.createLocal()` and
  `setupTestFixture()` automatically detect and use
  [movelite](https://github.com/gilbertsahumada/movelite) if the binary
  is available, reducing test boot time from ~15s to <1s. Falls back
  to the full Movement node if movelite is not installed. Opt out with
  `useMovelite: false` in `LocalTestOptions`. Closes #192.

- `movelite` declared as an `optionalDependency`. `npm install movehat`
  now also downloads the matching `movelite-<platform>` binary
  (via movelite's own optional dependencies on its platform packages),
  so the auto-spawn path above activates without a separate manual
  install step. Supported platforms: macOS arm64/x64, Linux x64/arm64.
  Unsupported platforms (e.g. Windows) install movehat cleanly and
  fall back to the Movement node. Closes #300.

- Shared local-node support via mocha root hooks. New `localNode`
  option on `LocalTestOptions` lets `Harness.createLocal()` and
  `setupTestFixture()` reuse a pre-started `LocalNodeManager`
  instead of spawning a new one per test file. `movehat init` now
  scaffolds a `tests/setup.ts` root hooks file that starts one
  Movement node for the entire test suite and stops it at the end.
  `Harness.cleanup()` is ownership-aware: when the node was injected
  via `localNode`, cleanup poisons the harness but does not stop the
  shared node. Reduces test-suite wall-clock time by ~23% for 3
  specs (~65s -> ~50s), scaling to ~50%+ at 10+ specs. Closes #235.

### Changed

- M9.4 (PR #290 — AccountManager static-facade removal) reverted.
  The static facade remains deprecated-but-functional indefinitely.
  Users see a once-per-method `logger.warning` pointing to
  `harness.accounts.<label>` / `harness.runtime.accountManager.*`
  but existing code continues to work without migration. No 0.3.0
  BREAKING release is planned. Closes #289.

### Security

- Runtime validation at every fork API and storage boundary. All
  Movement REST API responses (`getLedgerInfo`, `getAccount`,
  `getAccountResource`, `getAccountResources`) and on-disk JSON reads
  (`loadMetadata`, `getAccount`, `listAccounts`) are now validated
  against their expected shapes before use. Malformed upstream
  responses throw descriptive errors instead of silently propagating
  corrupt data. New `CoinStore` interface formalizes the coin-store
  resource shape; the last `any` in `src/fork/` is eliminated. New
  `src/fork/validation.ts` with 8 assertion functions. Closes #111.

### Docs

- Document that `movehat compile` auto-updates `Move.toml` with
  detected named addresses. New "Move.toml Auto-Update" section in
  `/docs/cli/compile`. CLI `--help` description updated to mention
  the behavior. Closes #212.

### Internal

- Complete §9 console UX migration: 14 raw `console.log/error` calls
  in `commands/test-move.ts`, `helpers/move-tests.ts`,
  `commands/fork/serve.ts`, and `helpers/version-check.ts` migrated
  to `logger.*` methods. All remaining `console.*` calls in `src/`
  are documented §9 exceptions (CLI table output, JSON passthrough,
  subprocess verbosity gate, banner rendering). Closes #223.

## [0.2.7] - 2026-05-22

M9 milestone progress (issue #270) — per-Harness `AccountManager`
isolation foundation with backward-compatible deprecation warnings on
the static facade. New projects on 0.2.7 get the forward-compatible
`harness.accounts.<label>` pattern; existing projects keep working
unchanged but see a one-time `logger.warning` per static method called.
Closes audit finding F8(a) for instance-API users.

Also lands the per-PR CHANGELOG convention (CLAUDE.md §11) and
backfills the post-0.2.6 polish entries (PR #274 closures).

### Added

- Re-export 4 public types from `movehat`: `InitRuntimeOptions`,
  `NetworkConfig`, `LocalTestingMode`, `ChildProcessAdapter`. Addresses
  TypeDoc warnings about unexported public-API symbols and lets users
  reference network configuration, runtime initialization, and custom
  child-process adapters directly from the main entry point. Closes #159.
- `CODE_OF_CONDUCT.md` at repo root using Contributor Covenant 2.1,
  with the contact placeholder substituted to `gilbertsahumada@gmail.com`.
  Closes #202.
- `AccountManager` instance API alongside the existing class-static
  surface. Construct via `new AccountManager(options?)` for a fully
  isolated pool (independent `labelMap`, `pool`, private-key map). New
  `AccountManagerOptions` interface exposes `{ poolPath?: string }`;
  when omitted, `poolPath` is evaluated lazily on each call (respecting
  `process.chdir()` between construction and pool I/O — the inverse of
  the legacy F8(b) static-API behavior). The static facade is preserved
  in 0.2.x for back-compat — every former static call forwards to a
  process-wide singleton whose `poolPath` is eagerly captured at module
  import (the legacy behavior). Removal of the static facade ships in
  0.3.0 (#270). Closes #277.
- Per-Harness account isolation. Each `Harness` now owns its own
  `AccountManager` instance reachable at `harness.runtime.accountManager`.
  New `Harness.accounts: Readonly<Record<string, Account>>` field exposes labeled
  accounts created at construction time (`accountLabels` in
  `createLocal` / `createFork` options) as a snapshot — late additions
  via `harness.runtime.accountManager.createAccount(...)` are not
  reflected. `Harness.createLive` produces an empty `accounts` Record
  (live mode does not create labeled accounts). New optional
  `InitRuntimeOptions.accountManager?` lets callers (`setupLocalTesting`,
  `setupTestFixture`) construct accounts before runtime init and thread
  the same instance through. Two `Harness.createLocal({ accountLabels:
  ["alice"] })` calls in the same process now produce DIFFERENT alice
  accounts — fixes the long-standing F8(a) label collision quirk that
  silently shadowed accounts across test files. Legacy `AccountManager.X()`
  static API still works unchanged via the singleton facade from M9.1
  (deprecation warning in 0.2.7, removal in 0.3.0). Closes #279.

### Deprecated

- `AccountManager` class-static methods (`AccountManager.createAccount`,
  `AccountManager.getLabeledAccounts`, `AccountManager.createBatch`, and
  the other 14 static facade methods) now emit a one-time
  `logger.warning` on the first call per method per process. The
  warning points users at `harness.accounts.<label>` for the common
  read path and `harness.runtime.accountManager.<method>` for advanced
  operations. The static facade still forwards to the module-level
  singleton unchanged — only the warning is new. Removal of the static
  API ships in 0.3.0 along with the migration guide. Closes #283.

### Changed

- `movehat init` template (`packages/movehat/src/templates/tests/Counter.test.ts`)
  and the canonical `examples/counter-example/tests/Counter.test.ts` now
  use `harness.accounts.<label>` instead of
  `AccountManager.getLabeledAccounts()`. New projects scaffolded with
  `movehat init` start on the forward-compatible pattern that survives
  the 0.3.0 break. Docs at
  `getting-started/quickstart`, `guides/multi-contract`, `guides/testing`,
  `guides/networks-and-modes`, and `api/harness` all rewritten to the
  new pattern. The `api/harness.mdx` "AccountManager Shared Pool"
  section that previously documented the F8 quirk as intentional
  behavior has been replaced with a "Per-Harness Account Isolation"
  section reflecting the post-M9 reality. Closes #283.
- Primary Node.js version in all GitHub Actions workflows bumped from
  `'20'` → `'22'`. CI matrix still covers both during the transition
  window; demotion of Node 20 is a separate decision for ~Aug 2026
  (Node 20 reaches EOL April 2026; GitHub Actions removes the Node 20
  runner on Sept 16, 2026). Closes #251.
- Docs Node.js floor aligned to v20+ in `installation.mdx` and
  `contributing/index.mdx` — matches the CI matrix and the v22 primary
  bump above. Closes #85.
- New `## Git Hooks` section in `CONTRIBUTING.md` documenting the 3
  husky hooks (pre-commit, commit-msg, pre-push), their skip flags
  (`MOVEHAT_E2E=1`, `MOVEHAT_SKIP_EXAMPLE_CHECK=1`), and the no-bypass
  policy (no `--no-verify` without a documented reason — matches
  CLAUDE.md §8). Closes #201.

### Tests

- 4 new unit tests for `Publisher.deploy()` covering happy path,
  `ModuleAlreadyDeployedError` early-exit when a prior deployment
  exists, `MH_CLI_REDEPLOY=true` bypass behavior, and build-failure
  idempotency (publish never invoked, no deployment record persisted).
  Coverage on `src/core/Publisher.ts`: lines 66.17% → 83.82%,
  statements 63.38% → 80.28%, branches 44.18% → 58.13%. Total unit
  tests: 539 → 543. Closes #61.

## [0.2.6] - 2026-05-21

7 audit-pass items closed across two layers — test coverage hardening and
security gate tightening. No public API changes; all behavior shifts are
strictly safer (silent → loud failure modes).

### Security

- `loadUserConfig` deduplicates concurrent cold-cache loads of the same
  config file via an in-flight Promise map. Previously two parallel
  callers raced on tsx's `register()` / `unregister()` cycle and the
  second's `await import()` could lose the loader mid-flight. Closes #47.
- Test-key auto-injection for `testnet` / `local` networks now requires
  BOTH the network NAME and the URL hostname to be in an allowlist
  (`testnet.movementnetwork.xyz`, `localhost`, `127.0.0.1`, `::1`).
  A user-named `testnet` pointing at a production URL no longer inherits
  the deterministic test key silently — instead a warning fires and the
  standard "no accounts configured" error gives actionable guidance.
  URL is sanitized in the log output (drops userinfo + query strings)
  to avoid leaking embedded credentials. Closes #40.
- `movehat run` resolves the `tsx` CLI from the bundled movehat copy
  first instead of the project cwd. Closes the supply-chain risk where
  a malicious `node_modules/tsx/dist/cli.mjs` in an untrusted project
  directory would silently execute. Opt-in env var
  `MOVEHAT_TSX_FROM_CWD=1` preserves the old behavior for power users
  who pin a different tsx version. Closes #52.
- All third-party GitHub Actions in `.github/workflows/*` pinned to
  40-char commit SHAs (not floating major tags) to close supply-chain
  drift from a maintainer-compromised tag re-point. Closes #214.
- `actions/checkout` in `docs-deploy.yml` now uses
  `persist-credentials: false` to avoid GITHUB_TOKEN persistence on
  the OIDC-based Pages deploy path.

### Fixed

- `parseTxHash` no longer falls back to "any 64-hex literal in stdout"
  when the contextual `transaction|txn|hash:` pattern misses. The
  fallback was fragile — a padded module address or state root printed
  before the actual transaction hash would silently return the wrong
  hash. Now returns `undefined` + logs a warning; the 3 callers
  (`Publisher`, `codeObject`, `script`) handle the missing value
  appropriately. Closes #51.

### Tests

- New integration test in `childProcessAdapter.test.ts` proves the
  spawn adapter passes args un-mangled (`./path`, embedded spaces,
  shell metacharacters, empty strings, unicode). Catches a regression
  class that PR #97 hit and unit tests with fake adapters missed.
  Closes #98.
- New consistency tests for `ForkServer.GET /v1/accounts/:address`
  prove short (`0x1`), padded (`0x000…01`), and mixed-case (`0xABC`)
  inputs all collapse to the same canonical key. The permissive regex
  is intentional (Movement uses short framework addresses); the
  consistency test locks in the existing normalization behavior.
  Closes #48.

### Internal

- Unit suite: 507 → 539 tests (+32 across the audit-pass batch).
- Removed public `SECURITY_AUDIT_2026-05-20.md` from the repo tree
  (history retained). `SECURITY.md` remains the public reporting
  channel. CHANGELOG entry for the M8 release updated to reflect the
  removal.

## [0.2.5] - 2026-05-21

### Added

- New `guides/tutorial-fork-testing.mdx` docs page — step-by-step
  tutorial for using `Harness.createFork(network)` to read live
  Movement state from a TypeScript test, with a working
  `runViewFunction` example against `0x1::coin::supply<AptosCoin>` and
  a demonstration of the synchronous deploy-rejection guard.
- New `guides/tutorial-deploy-live.mdx` docs page — step-by-step
  tutorial for `Harness.createLive(network)` covering `.env` setup,
  `deployCodeObject` + `upgradeCodeObject`, state preservation across
  upgrades (referencing the KPI 1 testnet smoke evidence), and common
  pitfalls (stale deployment records, `EOBJECT_DOES_NOT_EXIST`,
  accidental `--redeploy`).
- New `guides/tutorial-ci.mdx` docs page + reference workflow at
  `examples/counter-example/.github/workflows/ci.yml` — copy-paste-able
  GitHub Actions CI for end-user Movehat projects. The MDX code-fence
  and the committed YAML are byte-identical.
- `POST /v1/view` proxy on the fork server — `harness.runViewFunction`
  and `MoveContract.view` now work against forked networks by
  forwarding view-fn calls to upstream RPC. Stateless passthrough; no
  view-result caching. Whitelisted request headers (`Accept`,
  `X-Aptos-Client`) round-trip to upstream. Closes #243.
- `MoveContract.call` synchronous guard in fork mode — calling `.call`
  on a contract obtained from a fork-mode harness throws a clear
  "fork is read-only" error instead of falling through to the fork
  server's unhandled `/v1/transactions` endpoint and surfacing as
  HTTP 404. Helper: `createForkContractProxy` alongside the existing
  `createHarnessProxy`.
- New `MAINTENANCE.md` at the repo root — documents release cadence
  (patch / minor / per-milestone batch merges), issue triage SLA
  (24h security / 3 business days bug / 5 business days feature),
  SemVer versioning policy with pre-1.0 conventions, one-minor-release
  deprecation window, and Movement CLI compatibility / SHA256 pinning
  procedure.
- TypeDoc-emitted API reference sidebar now groups symbols by
  functional category (Harness / Account / Contract / Fork /
  Deployment Helpers / Errors / Other) instead of flat alphabetical,
  via a postprocess-script-only refactor in
  `packages/movehat/scripts/postprocess-typedoc.mjs`.
- New `packages/movehat/src/utils/movementCli.ts` helper — dedicated
  Movement CLI wrapper with argument validation, secret-redaction
  hooks, and a unit-test surface covering shape + invocation paths.

### Changed

- `packages/docs/content/docs/guides/networks-and-modes.mdx` rewritten
  to reflect actual fork-mode behavior — promoted `runViewFunction` /
  `MoveContract.view` from "Not yet supported" to "Supported" once
  the `POST /v1/view` proxy landed, and corrected the false claims
  about write rejection (the harness-Proxy gate covers
  `deployCodeObject` / `upgradeCodeObject` / `runMoveScript`;
  `MoveContract.call` gets the new fork-contract Proxy guard).
- CI Movement-binary cache isolated per job in
  `.github/workflows/ci.yml` so the E2E job no longer shares cache
  with the unit-test job (avoids cross-test contamination).
- CI Movement-binary SHA256 pin corrected across `.github/workflows/`,
  `examples/counter-example/.github/workflows/ci.yml`, and the
  `tutorial-ci.mdx` code fence so all three stay byte-identical with
  the canonical pin.
- Example workflow (`examples/counter-example/.github/workflows/ci.yml`)
  expanded with `MOVEMENT_CLI_BINARY_SHA256` verification step
  matching the tutorial reference (was previously tutorial-only).
- Example workflow Movement-CLI cache target moved from
  `/usr/local/bin/movement` (root-owned, EACCES on cache restore for
  the unprivileged runner user) to `${{ runner.temp }}/movement`,
  with `PATH` prepend.

### Fixed

- The networks-and-modes guide shipped with the KPI 1 docs site
  contained two factually-wrong claims about fork-mode write
  rejection. Corrected in PR #244 (M8.1); ships to movehat.org with
  this release.
- Fork server `POST /v1/view` proxy body-too-large path: `req.destroy()`
  ran before the 413 envelope could be written, so clients saw
  ECONNRESET instead of the structured error. Replaced with an
  overflow flag; pre-limit chunks stream as before, post-limit chunks
  are discarded by an early-return guard in the data handler. New
  unit test asserts the 413 actually reaches the client.
- `networks-and-modes.mdx` "When to reach for it" paragraph
  contradicted the supported view-fn list in the bullet above it;
  reconciled so both align on `createFork` supporting view functions.
- `tutorial-ci.mdx` troubleshooting heading typo: `move:` →
  `movement:` (binary is named `movement`).
- `tutorial-fork-testing.mdx` intro caching claim qualified to
  distinguish cached accounts/resources from proxied view functions.
- Child process timeout coverage test stabilized — flake source was
  a timing assertion that raced the SIGTERM handler.

### Security

- Hardened Movement CLI execution path: argument validation in
  `childProcessAdapter.ts`, expanded secret-redaction patterns in
  `redact.ts`, and a dedicated `movementCli.ts` wrapper module that
  centralizes flag handling. Reduces blast radius of any future
  input-injection bug in callers.
- Hardened fork server: CORS origin allow-list rejects untrusted
  origins with HTTP 403; wrong-method requests on known endpoints
  return HTTP 405 with `Allow` header; malformed percent-encoded
  resource paths return HTTP 400 instead of crashing the handler.
  Fork storage layer gained path-traversal protections.
- `AccountManager` no longer persists imported accounts to disk —
  only auto-generated test accounts are saved; imported private keys
  remain in memory for the lifetime of the process. Prevents
  accidental persistence of user-supplied keys to `.movehat/accounts/`.
- Pre-publish gates tightened: `prepublishOnly` script, expanded
  `scripts/check-pack-contents.js` denylist, additional `publish.yml`
  guards. An internal security review was completed on 2026-05-20;
  all confirmed Medium findings closed in this release. Contact the
  maintainers via the channel in `SECURITY.md` for review details.

---

## [0.2.4] - 2026-05-17

### Added

- New `guides/multi-contract.mdx` docs page — step-by-step tutorial for
  extending a `movehat init` project with a second Move module
  (Registry), demonstrating events + standard `std::error` wrappers +
  multi-module `autoDeploy`. Includes a troubleshooting section
  covering the Movement local-node clock-drift behaviour observed when
  many test specs run sequentially.
- New `cli/global-flags.mdx` docs page — documents the global
  `-v / --verbose` flag, `--network`, `--redeploy`, plus the
  `MOVEHAT_VERBOSE` / `MOVEHAT_NETWORK` / `NO_COLOR` env vars.
- New `guides/console-output.mdx` docs page — user-facing explanation
  of the §9 five-source taxonomy (system / subprocess / user / SDK
  warnings / mocha) and how non-TTY / `NO_COLOR` graceful degradation
  works.
- `api/harness.mdx` gains an "About `accountLabels`" subsection
  clarifying that labeled accounts are independent of
  `harness.runtime.account`, each gets its own keypair plus 1 MOVE
  from the faucet, and the retrieval pattern via
  `AccountManager.getLabeledAccounts()`.
- `examples/counter-example/move/sources/registry.move` — reference
  implementation of the tutorial's Registry module, shipped as part
  of the counter-example for inspection.

### Fixed

- User-facing strings now correctly refer to the native token as
  **MOVE** instead of APT. Movement L1's native token is MOVE; APT is
  Aptos's token. The display strings emitted during faucet funding
  and local-testing setup were using APT, which was incorrect
  rebranding for a Movement-native dev framework. Touched
  `LocalNodeManager.fundAccounts`, `setupLocalTesting` balance log
  (two sites), plus JSDoc comments in `LocalNodeManager`,
  `types/config.ts`, and `fork/manager.ts`. Also corrects a math
  error in the comments: 100_000_000 octas is 1 MOVE (10^8 octas),
  not 100. The runtime math was always correct; only the comments
  were wrong about the unit count.

---

## [0.2.3] - 2026-05-17

### Added

- Global `-v` / `--verbose` CLI flag and `MOVEHAT_VERBOSE=1` env var.
  Opt-in surfacing of subprocess output from `movement node run-localnet`,
  `aptos move build`, and `aptos move publish` for debugging slow startups,
  build hangs, or git-dependency downloads. By default this output is hidden.
- `withTimedSpinner` UI helper (`packages/movehat/src/ui/spinner.ts`) wrapping
  long async tasks with a spinner that updates its label every 500ms with the
  elapsed wall-clock time. Replaces the silent 10-30s wait during local-node
  startup with live progress feedback.
- `logger.phase(title)` and `logger.divider()` helpers (`packages/movehat/src/ui/logger.ts`)
  rendering consistent `━` rules + bold brand-colored titles at phase
  boundaries. Replaces the ad-hoc `console.log(colors.bold(...))` +
  `console.log(colors.muted("─".repeat(50)))` pattern.
- CLAUDE.md §9 — Console UX conventions. Codifies the five-source taxonomy
  (system / subprocess / user / SDK warnings / mocha) and the rules every
  future PR must follow when emitting to the user's terminal.
- 14 new unit tests covering verbosity helpers (`isVerbose()`, `phase()`,
  `divider()`) and subprocess output filtering (`LocalNodeManager` stdout/
  stderr handlers, critical-signal escalation regardless of verbosity).

### Changed

- Local-node startup output is now spinner-driven. Routine `[Node] ...`
  chatter from the `movement` subprocess is hidden by default; pass `-v` to
  see it (muted gray `›` prefix). Critical signals (`panic`, `fatal`,
  `address already in use`, `EADDRINUSE`) always surface as warnings
  regardless of verbosity — the user is never silenced through a real failure.
- Publisher's `aptos move build` and `aptos move publish` steps wrapped in
  `withSpinner`. Their stdout/stderr passthroughs gated behind `isVerbose()`.
- `commands/test.ts` orchestrator headers use `logger.phase` (replaces
  ad-hoc bold + repeated rule lines).
- `setupLocalTesting` opens with a `logger.phase` banner.
- Subprocess `stderr` is no longer assumed to be an error. Movement CLI
  emits informational progress messages on stderr ("Applying post startup
  steps...", "Compiling, may take a little while...") alongside real errors.
  Both stdout and stderr now follow the same verbosity gate; only lines
  matching critical signals are escalated.

### Fixed

- `publish.yml` post-publish "Commit version bump back" step no longer fails
  when `origin/main`'s `package.json` already matches the released version
  (the typical release-via-PR flow). Previously the unconditional
  `git stash push → checkout main → rebase → stash pop` dance produced
  "No stash entries found" when there was no diff to stash and exited 1.
  An early-exit guard now compares the tag's version to main's version and
  exits cleanly when they match. The original stash/rebase/pop is preserved
  for the edge case of a tag created from a feature branch whose version
  bump never landed on main. Closes
  [#174](https://github.com/gilbertsahumada/movehat/issues/174).

### Internal

- 26 raw `console.log` / `console.error` / `console.warn` callsites migrated
  to the equivalent `logger.*` method across `fork/manager.ts`,
  `fork/server.ts`, `fork/test.ts`, `core/config.ts`, `core/deployments.ts`,
  `harness/script.ts`, `harness/codeObject.ts`. Secondary §9 sweep across
  `commands/test-move.ts`, `helpers/move-tests.ts`, `core/AccountManager.ts`,
  `commands/fork/serve.ts`, `helpers/version-check.ts` tracked in
  [#223](https://github.com/gilbertsahumada/movehat/issues/223).
- `formatters.divider` unexported from the wildcard `ui/` namespace (it
  conflicted with the new `logger.divider`); the function stays accessible
  as a local helper inside `formatters.ts` for `formatters.sectionHeader`.

---

## [0.2.2] - 2026-05-16

### Added

- Re-export six Harness option/result types from the root `movehat`
  entry point (`DeployCodeObjectOptions`, `UpgradeCodeObjectOptions`,
  `CodeObjectInfo`, `RunViewFunctionOptions`, `RunMoveScriptOptions`,
  `MoveScriptResult`). Closes
  [#200](https://github.com/gilbertsahumada/movehat/issues/200) —
  callers can now type wrappers around Harness methods without
  deep-importing from internal paths.
- `examples/counter-example/scripts/upgrade-counter.ts` demonstrates
  `harness.upgradeCodeObject` against an existing deployment.
- `examples/counter-example/scripts/run-script.ts` plus
  `move/scripts/echo.move` demonstrate `harness.runMoveScript` against
  a local node.
- `examples/counter-example/scripts/demo-harness-fork.ts` demonstrates
  the high-level `Harness.createFork` factory (read-only view +
  write-rejection contract + post-cleanup poisoning via
  `HarnessDisposedError`). Complements the existing low-level
  `demo-fork.ts`. Closes
  [#199](https://github.com/gilbertsahumada/movehat/issues/199).
- `examples/counter-example/README.md` documenting the npm script
  surface.

### Changed

- `movehat init <name>` now sanitizes the project name into a valid Move
  identifier when writing `move/Move.toml`, preserving the original name for
  `package.json` and the directory. Invalid characters (hyphens, slashes,
  dots) are replaced with underscores; names starting with a digit are
  prefixed with `pkg_`. A warning is printed when sanitization changes the
  name. Names that resolve to nothing usable (`.`, `..`, empty, only
  separators) are now rejected with a clear error. Previously, passing a
  path like `/tmp/my-project` produced a malformed `Move.toml` and a cryptic
  `"No such file or directory"` compile failure. Closes
  [#195](https://github.com/gilbertsahumada/movehat/issues/195).

### Deprecated

### Removed

### Fixed

- Template `scripts/deploy-counter.ts` previously attempted
  `counter::increment` immediately after deploy, before the required
  `counter::init` call. New users running the canonical happy path
  (`movehat init <name>` → `movehat run scripts/deploy-counter.ts`)
  hit `E_NOT_INITIALIZED(0x2)` on their first script execution. The
  script now calls `init` before `increment` with an explanatory
  comment about the Move resource pattern.
- Template `move/sources/Counter.move` hardened with auto-init in
  `increment` as defense in depth. A new Move-level test
  (`test_increment_auto_inits`) locks the auto-init behavior so a
  future refactor can't accidentally remove the defense.
- `[Aptos SDK]` AIP-80 deprecation warning suppressed in
  `AccountManager.loadAccountFromPrivateKey` and `core/config.ts`
  `deriveAccountAddress` by formatting raw hex private keys with
  `PrivateKey.formatPrivateKey` before passing them to
  `Ed25519PrivateKey`. Cosmetic; no behavior change.
- `scripts/e2e-local.sh` (which feeds `pnpm test:e2e:quick` on every
  PR and `scripts/pre-publish.sh` for releases) now actually executes
  `deploy-counter.ts` against Movement testnet and asserts that
  "Counter value: 1" appears in the output. Previously the script
  only validated template files exist, which is how the
  `E_NOT_INITIALIZED` regression slipped through.
- `movement move deploy-object` / `move upgrade-object` / `move
  publish` / `move run-script` no longer require `~/.aptos/config.yaml`
  (or `~/.movement/config.yaml` on newer CLI variants) to exist on the
  user's machine. Previously movehat wrote a temporary profile to that
  yaml and passed `--profile <name>` to the CLI, which forced a fresh
  install to hit `Unable to find config <cwd>/.aptos/config.yaml, have
  you run aptos init?`. The new flow writes the private key to a
  `mode 0o600` temp file in `os.tmpdir()` and passes
  `--private-key-file <path>` + `--sender-account <addr>` directly to
  the CLI — no yaml lookup chain, no CWD dependency, no CLI-variant
  dependency. Profile management code in `core/movementProfile.ts`
  was refactored accordingly; the SIGINT/SIGTERM cleanup pipeline still
  applies (the temp key file is unlinked on both normal exit and on
  abnormal exit). Closes
  [#208](https://github.com/gilbertsahumada/movehat/issues/208).
- Template `move/sources/Counter.move` regression-test docblock
  switched from `///` (Move doc-comment, only valid on items the
  compiler recognizes) to `//` (regular comment) so it doesn't
  trigger `invalid documentation comment` warnings on
  `movement move test`.
- Audit findings (10 items, TDD-validated, [#215](https://github.com/gilbertsahumada/movehat/pull/215)):
  - F1: `Harness.createFork` now honors the `network` argument (was silently routing all callers to testnet).
  - F2: Fork server closes CORS by default; opt-in via `corsAllowOrigins` config.
  - F3: `MovementApiClient` adds request timeout + `maxBytes` guard.
  - F4: `ChildProcessAdapter.run` adds a `maxBuffer` guard.
  - F5: `withYamlLock` docstring tightened to make process-local scope explicit, with an `it.skip` test pinning the cross-process gap (the originally-shipped fix). The follow-up [#210](https://github.com/gilbertsahumada/movehat/pull/210) refactor in this same release subsequently removed `withYamlLock` entirely (replaced with per-deploy temp key files), which resolves the cross-process race incidentally — no shared yaml file remains to race on. Cross-process lock hardening for the yaml flow is therefore obsolete; the issue stays open at [#211](https://github.com/gilbertsahumada/movehat/issues/211) for any future code path that revives shared-file state.
  - F6: Removed stale `packages/movehat/package-lock.json` left over from a prior tooling change.
  - F7: Pinned `movehat compile` Move.toml mutation behavior with a regression test; product decision tracked in [#212](https://github.com/gilbertsahumada/movehat/issues/212).
  - F8: AccountManager's static-state lifecycle + import-time cwd capture documented + locked by behavioral tests; instance-per-Harness refactor tracked in [#213](https://github.com/gilbertsahumada/movehat/issues/213).
  - F9: `LocalNodeManager` refuses to misreport the REST API port; deprecated the misleading `apiPort` option.
  - F10: CI audit gate hardened; publish workflow validates version input for both `release: published` and `workflow_dispatch` triggers.
- CI E2E gate now installs the freshly-built tarball into the
  user-project under test (previously `npm install` resolved
  `"movehat"` from the npm registry, so the gate exercised stale
  published code instead of the diff under review). This fix is
  what let CI on the second batch confirm that PR
  [#210](https://github.com/gilbertsahumada/movehat/pull/210)
  actually resolves
  [#208](https://github.com/gilbertsahumada/movehat/issues/208) on
  Linux CI. ([#217](https://github.com/gilbertsahumada/movehat/pull/217))
- CI audit gate now triggers at `--audit-level critical` (was
  default, which failed on any severity). 27 advisories in total
  (13 rated high severity, the remainder moderate/low) in
  `packages/docs` transitive dependencies (Fumadocs, Next.js,
  Vite, Rollup) are documented in `SECURITY.md` as
  known-not-impacting — none reach the published `movehat` package
  on npm. **Resolution path**: Next.js must first ship a release
  that supports the docs site's static-export configuration, then
  Fumadocs must release a version that depends on that Next.js. The
  repo cannot upgrade Fumadocs unilaterally because today's
  Fumadocs depends on Next.js 16 features that break our static
  build, and patched Next.js versions live downstream of that.
  ([#217](https://github.com/gilbertsahumada/movehat/pull/217))

### Security

- `SECURITY.md` adds a "Known advisories in development
  dependencies" section enumerating the 13 high-severity
  advisories in `packages/docs` build infrastructure that the
  audit gate acknowledges. Resolution path: Next.js must ship a
  static-export-compatible release first, then Fumadocs must
  release a version that depends on it.

---

## [0.2.1] - 2026-05-15

### Fixed

- npm registry README was stuck on the pre-reorg version because `packages/movehat/README.md` had drifted ~6 months behind the workspace-root `README.md`. The package's README has been resynced with the current root README (aggressively reorganized in [#178](https://github.com/gilbertsahumada/movehat/pull/178) + [#187](https://github.com/gilbertsahumada/movehat/pull/187)), and a `prepack` lifecycle script now auto-syncs the file on every `npm pack` / `npm publish` so drift cannot recur. Closes [#189](https://github.com/gilbertsahumada/movehat/pull/189).

### Changed

- Docs site migrated to the custom domain `https://movehat.org` (was `gilbertsahumada.github.io/movehat`). All README + in-package documentation links updated. ([#184](https://github.com/gilbertsahumada/movehat/pull/184))
- README aggressively reorganized: 873 → 214 lines (-75%). Replaced the dump-style feature list with a Quick Start + one canonical Harness test + one canonical deployment script + CLI reference table + troubleshooting table. Long-form content lives on the docs site. ([#178](https://github.com/gilbertsahumada/movehat/pull/178), [#187](https://github.com/gilbertsahumada/movehat/pull/187))
- Docs landing + intro page redesigned with Fumadocs Cards / Tabs / Callout components, mobile-first responsive layout, terminal preview, and copy buttons on all code snippets. ([#187](https://github.com/gilbertsahumada/movehat/pull/187))
- Deployment example in README modernized from the legacy `harness.runtime.deployContract()` path to `harness.deployCodeObject({ moduleName })` to match the shipped template. ([#187](https://github.com/gilbertsahumada/movehat/pull/187))
- CI workflow narrowed to fire only on `push:main` + PRs targeting `main` (was `push: [main, develop, feature/*]` + PRs to both). The `develop → main` batch PR is now the single internal-CI checkpoint; sub-PRs to develop rely on local Tier-1 + §8 self-review. `workflow_dispatch` added as manual escape hatch. ([#186](https://github.com/gilbertsahumada/movehat/pull/186))
- Minimum Node version aligned to `>= 20` (was inconsistent — package.json `engines.node` already required 20+ but contributor docs / docker-compose said 18). Dropped the `test-node18` Docker service and the `pnpm docker:test:node18` script. ([#184](https://github.com/gilbertsahumada/movehat/pull/184))

---

## [0.2.0] - 2026-05-15

### Removed

- **BREAKING**: `getMovehat()` (and the `mh()` alias from earlier alpha releases) has been removed. The function was previously marked `@deprecated` and pointed callers at the Hardhat-style `Harness.create*` factories. Migration: replace `const mh = await getMovehat()` with either `const harness = await Harness.createLive("testnet")` (new code, lifecycle-managed) or `const runtime = await initRuntime()` (advanced use-case, equivalent to the old `getMovehat` behavior). See [#73](https://github.com/gilbertsahumada/movehat/issues/73) + [#166](https://github.com/gilbertsahumada/movehat/issues/166).

### Changed

- Bumped to `0.2.0` per semver-under-0.x convention: removing a publicly-exported function is a breaking change. Users pinning `~0.1` will not auto-upgrade — explicit version bump required.
- `MovehatRuntime` type export retained (live runtime type used by `Harness.runtime`, `initRuntime()`, and all harness helpers — was misidentified as "legacy" in [#73](https://github.com/gilbertsahumada/movehat/issues/73); correction documented in [#168](https://github.com/gilbertsahumada/movehat/pull/168)).

### Added

Developer experience:

- Auto-generated API reference at `/api/reference/{classes,interfaces,functions,type-aliases}/` via TypeDoc + Fumadocs ([#160](https://github.com/gilbertsahumada/movehat/pull/160)).
- Fork-system performance baseline + `BENCHMARKS.md` ([#161](https://github.com/gilbertsahumada/movehat/pull/161)).
- `MOVEMENT_CLI_COMPAT.md` with SHA256-pinned CLI artifact integrity ([#162](https://github.com/gilbertsahumada/movehat/pull/162), closes [#140](https://github.com/gilbertsahumada/movehat/issues/140)).

Release pipeline:

- `CHANGELOG.md` gate enforced in `publish.yml` — releases without a matching `## [X.Y.Z]` section fail before publishing ([#167](https://github.com/gilbertsahumada/movehat/pull/167)).
- Unit + integration tests run in `publish.yml` before `npm publish`.

### Fixed

- `ForkManager.fundAccount` and `getOrCreateAccount` previously synthesized `authentication_key` via `address.padEnd(66, '0')`, which was a no-op for already-66-char normalized addresses (`auth_key === address`). Replaced with `sha3-256(addrBytes)` — distinguishable from the address by construction. Closes [#63](https://github.com/gilbertsahumada/movehat/issues/63).

---

## [0.1.9] - 2026-01-10

### Changed

- Final pre-roadmap dev release in the `feature/improve-commands` cycle (PR #32). Iterative CLI + helper polish.

## [0.1.8] - 2026-01-10

### Changed

- Pre-roadmap dev release (PR #31). CLI ergonomics / minor fixes.

## [0.1.7] - 2026-01-10

### Changed

- Pre-roadmap dev release (PR #30). CLI ergonomics / minor fixes.

## [0.1.6] - 2026-01-10

### Changed

- Pre-roadmap dev release (PR #29). CLI ergonomics / minor fixes.

## [0.1.5] - 2026-01-08

### Changed

- Pre-roadmap dev release (PR #28). CLI ergonomics / minor fixes.

## [0.1.4] - 2026-01-08

### Changed

- Pre-roadmap dev release (PR #28). CLI ergonomics / minor fixes.

## [0.1.3] - 2026-01-06

### Changed

- Pre-roadmap dev release (PR #27). CLI ergonomics / minor fixes.

## [0.1.2] - 2026-01-06

### Changed

- Pre-roadmap dev release (PR #26). CLI ergonomics / minor fixes.

## [0.1.1] - 2025-12-31

### Added

- Initial 0.1.x line. Fork option support (PR #23).

> **Note:** Version `0.1.0` was never published to npm — the public release line jumps from `0.0.10-alpha.0` to `0.1.1`. A tag `v0.1.0` exists in git history but no artifact was uploaded.

> Pre-`0.1.1` history (`0.0.1-alpha.0` through `0.0.10-alpha.0`) is not backfilled — those were early experimental releases before the project established a CHANGELOG.

> The CHANGELOG gate added in PR #167 enforces strict matching of `package.json` version against a `## [X.Y.Z]` section in this file. From 0.2.0 onward, every published version gets a curated entry above.
