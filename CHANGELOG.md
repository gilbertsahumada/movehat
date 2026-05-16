# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

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
