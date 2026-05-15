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

## [0.2.0] - 2026-05-15

### Removed

- **BREAKING**: `getMovehat()` (and the `mh()` alias from earlier alpha releases) has been removed. The function was marked `@deprecated` since M2.4 and pointed callers at the Hardhat-style `Harness.create*` factories. Migration: replace `const mh = await getMovehat()` with either `const harness = await Harness.createLive("testnet")` (new code, lifecycle-managed) or `const runtime = await initRuntime()` (advanced use-case, equivalent to the old `getMovehat` behavior). See [#73](https://github.com/gilbertsahumada/movehat/issues/73) + [#166](https://github.com/gilbertsahumada/movehat/issues/166).

### Changed

- Bumped to `0.2.0` per semver-under-0.x convention: removing a publicly-exported function is a breaking change. Users pinning `~0.1` will not auto-upgrade — explicit version bump required.
- `MovehatRuntime` type export retained (live runtime type used by `Harness.runtime`, `initRuntime()`, and all harness helpers — was misidentified as "legacy" in meta-issue #73; correction documented in PR M6.2).

### Added

- M5 cycle (shipped to develop pre-0.2.0; user-visible side effects):
  - Auto-generated API reference at `/api/reference/{classes,interfaces,functions,type-aliases}/` via TypeDoc + Fumadocs ([#160](https://github.com/gilbertsahumada/movehat/pull/160)).
  - Fork-system performance baseline + `BENCHMARKS.md` ([#161](https://github.com/gilbertsahumada/movehat/pull/161)).
  - `MOVEMENT_CLI_COMPAT.md` with SHA256-pinned CLI artifact integrity ([#162](https://github.com/gilbertsahumada/movehat/pull/162), closes [#140](https://github.com/gilbertsahumada/movehat/issues/140)).
- M6 cycle:
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

> The CHANGELOG gate added in M6 (PR #73 follow-up) enforces strict matching of `package.json` version against a `## [X.Y.Z]` section in this file. From 0.2.0 onward, every published version gets a curated entry above.
