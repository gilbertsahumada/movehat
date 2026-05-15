# Testing Strategy for MoveHat

Complete testing and validation guide before publishing.

## Table of Contents

1. [Testing Levels](#testing-levels)
2. [Local Testing](#local-testing)
3. [Docker Testing](#docker-testing)
4. [Pre-Publish Checklist](#pre-publish-checklist)
5. [CI/CD Pipeline](#cicd-pipeline)
6. [Manual Testing Steps](#manual-testing-steps)

---

## Testing Levels

### 1. **Unit Tests** (~2 seconds)
- 35 test files, 397 tests across `packages/movehat/src/**/__tests__/`
- Vitest with v8 coverage; per-file ≥80% gates on 16 critical modules, global ≥70% floor
- Run via `pnpm --filter movehat test` (no Movement node required)
- Coverage gate enforced in CI via `Check coverage threshold` step in `.github/workflows/ci.yml`

### 2. **Smoke Tests** (~30 seconds)
- Critical path validation
- Package installation test
- Basic CLI commands
- **Script:** `scripts/smoke-test.sh`

### 3. **E2E Tests** (~2-3 minutes)
- Complete user workflow simulation
- Project initialization
- Compilation
- Test execution
- **Script:** `scripts/test-e2e.sh`

### 4. **Integration Tests (zero-mock)** (~2-3 minutes)
- Vitest suite at `packages/movehat/test/integration/`
- Drives the full Harness lifecycle against the real Movement CLI (no `vi.mock`)
- Self-contained Move fixtures at `test/integration/fixtures/move/{v1,v2}/`
- Fork-mode tests skip automatically when `MOVEMENT_RPC_URL` is unset
- **Requires:** Movement CLI on PATH; optional testnet endpoint for fork tests

---

## Local Testing

### Quick Smoke Test

```bash
# Run smoke tests (fast validation)
bash scripts/smoke-test.sh
```

This tests:
-  Package builds correctly
-  Package can be installed globally
-  CLI commands work
-  Project initialization works
-  Basic file structure is created

### Full E2E Test

```bash
# Run complete E2E test suite
bash scripts/test-e2e.sh
```

This tests:
-  Movement CLI is installed
-  Node.js version compatibility
-  Build from source
-  Global installation
-  Project initialization
-  Dependency installation
-  Move contract compilation
-  Move unit tests
-  TypeScript integration tests
-  All CLI commands

### Integration Suite (zero-mock)

A vitest-native suite that drives the real Movement CLI through the
public Harness lifecycle. Lives at `packages/movehat/test/integration/`.
Failures here indicate either a Movement CLI behavioral change upstream
or a regression in the Harness wrapper.

```bash
# Full integration suite (~2-3 min). Fork tests skip without env.
pnpm test:integration
```

To exercise the fork-mode tests, set `MOVEMENT_RPC_URL`:

```bash
MOVEMENT_RPC_URL=https://testnet.movementnetwork.xyz/v1 pnpm test:integration
```

This exercises:
-  `Harness.createLocal` boot + Movement node startup
-  `deployCodeObject` against a real Move package (v1 fixture)
-  `runViewFunction` against the deployed module
-  `MoveContract.call` for entry-function invocation
-  `runMoveScript` against a no-op script
-  `upgradeCodeObject` to a v2 fixture at the same object address
-  v2-only entry function (`reset`) proving the upgrade is live
-  `cleanup` idempotency
-  Fork-mode read path + read-only enforcement (skipped without `MOVEMENT_RPC_URL`)

#### Running via Docker

The repo's `docker-compose.test.yml` already wires a `test-integration`
service:

```bash
docker compose -f docker-compose.test.yml run --rm test-integration
```

Use this when you need a fully isolated environment (no host `~/.aptos`
or `~/.movement` state leaking into the run).

#### Adding a new integration test

- File suffix MUST be `.integration.test.ts`.
- Use `Harness.createLocal` / `Harness.createFork`; **never** `vi.mock` /
  `vi.spyOn` — CI fails the build if the suite contains those calls.
- Wrap real state in `beforeAll` / `afterAll` with `harness.cleanup()`.
- Budget: aim for ≤30s per test to stay under the CI 5-minute SLO.

### Pre-Publish Validation

```bash
# Run complete pre-publish checklist
bash scripts/pre-publish.sh
```

This checks:
-  Git status (no uncommitted changes)
-  Version tag doesn't exist
-  TypeScript types are valid
-  Build succeeds
-  Smoke tests pass
-  Package size is reasonable
-  package.json is complete
-  Dependencies are correct
-  README has required sections
-  npm credentials are configured

---

## Docker Testing

Docker testing provides **isolated, reproducible environments** to test installation and usage across different configurations.

### Test Single Configuration

```bash
# Test on Node 20
docker-compose -f docker-compose.test.yml up test-node20

# Test on Node 18
docker-compose -f docker-compose.test.yml up test-node18

# Test on Node 22
docker-compose -f docker-compose.test.yml up test-node22
```

### Test Global Installation

```bash
# Simulate complete user installation flow
docker-compose -f docker-compose.test.yml up test-global-install
```

This simulates:
1. Fresh Node.js environment
2. Building from source
3. Creating tarball package
4. Installing globally with npm/yarn
5. Running movehat commands
6. Creating and testing a project

### Test All Configurations

```bash
# Run all test services
docker-compose -f docker-compose.test.yml up --abort-on-container-exit
```

### Clean Up Docker

```bash
# Remove test containers and images
docker-compose -f docker-compose.test.yml down --rmi local --volumes
```

---

## Pre-Publish Checklist

Before publishing to npm, complete this checklist:

### 1. Code Quality

- [ ] All TypeScript types are valid (`pnpm tsc --noEmit`)
- [ ] Build succeeds without errors (`pnpm build:movehat`)
- [ ] No console.log in production code
- [ ] All TODOs are resolved or documented

### 2. Version Management

- [ ] Version bumped in `packages/movehat/package.json`
- [ ] CHANGELOG.md updated with changes
- [ ] Git tag doesn't exist for this version
- [ ] On main/master branch (or intentional release branch)

### 3. Package Validation

- [ ] Smoke tests pass (`bash scripts/smoke-test.sh`)
- [ ] E2E tests pass (`bash scripts/test-e2e.sh`)
- [ ] Docker tests pass (at least Node 18 & 20)
- [ ] Package size is reasonable (<10MB)

### 4. Documentation

- [ ] README.md is up to date
- [ ] CHANGELOG.md has version entry
- [ ] Examples work correctly
- [ ] Demo tutorial is accurate

### 5. Dependencies

- [ ] No unnecessary dependencies
- [ ] Dependencies are in correct section (deps vs devDeps)
- [ ] No security vulnerabilities (`pnpm audit`)
- [ ] Peer dependencies documented

### 6. npm Configuration

- [ ] Logged into npm (`npm whoami`)
- [ ] Have publish access to package
- [ ] .npmignore or files field is correct
- [ ] package.json fields are complete

### 7. Templates

- [ ] Template files are included in package
- [ ] Template package.json has correct version
- [ ] Template contracts compile without warnings
- [ ] Template tests pass

---

## CI/CD Pipeline

### Automated Testing (GitHub Actions)

Every push and PR triggers:

```yaml
Build & Type Check  Test Matrix  Quality Checks  Security Audit
```

#### Build & Type Check
- TypeScript compilation
- Build artifacts creation
- Upload for later jobs

#### Test Matrix
- Tests on Node 18, 20, 22
- Smoke tests on each version
- Fail-fast disabled to see all results

#### Quality Checks
- package.json validation
- Required fields check
- TODO/FIXME detection

#### Security Audit
- Dependency vulnerability scan
- Production dependencies only

### Automated Publishing

On version tag push (e.g., `v0.1.0`):

```yaml
Pre-Publish Checks  Publish to npm  Create GitHub Release  Verify Install
```

#### Pre-Publish Checks
- All CI checks pass
- Version matches tag

#### Publish to npm
- Build package
- Publish to npm registry
- Handle alpha/beta tags

#### Create GitHub Release
- Auto-generate release notes
- Link to CHANGELOG
- Mark pre-releases appropriately

#### Verify Install
- Wait for npm sync
- Install from npm
- Test basic commands

---

## Manual Testing Steps

### Before Every Release

#### 1. Test Installation Fresh

```bash
# In a clean directory (not the project)
npm install -g movehat
movehat --version
movehat init test-project
cd test-project
npm install
```

#### 2. Test Compilation

```bash
movehat compile
# Should succeed without warnings
```

#### 3. Test Move Tests

```bash
movehat test --move
# or
movehat test:move
# Should pass all tests
```

#### 4. Test TypeScript Tests

```bash
movehat test --ts
# or
npm test  # Then select "TypeScript integration tests"
# Should run TypeScript tests with local node
```

#### 5. Test All Tests

```bash
movehat test --all
# Should run both Move and TypeScript tests
```

#### 6. Test Interactive Menu

```bash
movehat test
# Should show interactive menu:
# ? What tests do you want to run?
# ❯ Move unit tests (fast, no node required)
#   TypeScript integration tests (starts local node)
#   All tests (Move + TypeScript)
```

#### 7. Test Update Command

```bash
movehat update
# Should check for updates
```

#### 8. Test Help Commands

```bash
movehat --help
movehat compile --help
movehat test --help
movehat fork --help
```

#### 9. Test on Different Systems (if possible)

- [ ] macOS (Intel)
- [ ] macOS (Apple Silicon)
- [ ] Linux (Ubuntu/Debian)
- [ ] Windows (WSL)

### Critical User Flows

#### Flow 1: Complete Beginner

```bash
# User has Node.js but no Movement experience
npm install -g movehat
movehat init my-first-project
cd my-first-project
npm install
npm test  # Should work without any configuration
```

#### Flow 2: Experienced Move Developer

```bash
# User wants to use existing Move code
movehat init existing-project
cd existing-project
# Replace move/sources/Counter.move with their code
movehat compile
npm test
```

#### Flow 3: CI/CD Integration

```bash
# In a CI environment
npm install -g movehat
movehat compile
movehat test --move  # Fast tests only (no node required)
```

---

## 🚨 Common Issues to Test For

### Installation Issues

- [ ] Package installs globally without errors
- [ ] CLI is available in PATH
- [ ] Works with npm, yarn, and pnpm
- [ ] Works with different Node versions (18, 20, 22)

### Runtime Issues

- [ ] Movement CLI not found (graceful error)
- [ ] Network connection issues (Transaction Simulation)
- [ ] Missing dependencies in user project
- [ ] Invalid Move.toml configuration

### Template Issues

- [ ] All template files are included
- [ ] Templates compile without warnings
- [ ] Template tests pass
- [ ] Template scripts work

### Cross-Platform Issues

- [ ] File paths work on Windows
- [ ] Permissions are correct on Unix systems
- [ ] Line endings are handled correctly
- [ ] Shell scripts have proper shebangs

---

## Release Process

### 1. Prepare Release

```bash
# Update version
cd packages/movehat
npm version patch  # or minor, major

# Update CHANGELOG.md
# Commit changes
git add .
git commit -m "chore: bump version to x.x.x"
```

### 2. Run Pre-Publish Checks

```bash
bash scripts/pre-publish.sh
```

Fix any issues before proceeding.

### 3. Test in Docker

```bash
docker-compose -f docker-compose.test.yml up test-global-install
```

Ensure clean installation works.

### 4. Create and Push Tag

```bash
git tag -a v0.x.x -m "Release v0.x.x"
git push origin v0.x.x
```

This triggers automated publishing via GitHub Actions.

### 5. Verify Published Package

```bash
# Wait 2-3 minutes for npm registry sync
npm view movehat version

# Test installation
npm install -g movehat@latest
movehat --version
```

### 6. Update Documentation

- [ ] Update main README if needed
- [ ] Update demo tutorial if needed
- [ ] Announce release (Twitter, Discord, etc.)

---

## Testing Metrics

Track these metrics for quality:

- **Test Coverage** (future): Target >80%
- **Build Time**: Should be <30 seconds
- **Package Size**: Should be <5MB
- **Install Time**: Should be <60 seconds
- **E2E Test Duration**: Should be <3 minutes
- **Smoke Test Duration**: Should be <30 seconds

---

## Useful Commands

```bash
# Build package
pnpm build:movehat

# Run smoke tests
bash scripts/smoke-test.sh

# Run E2E tests
bash scripts/test-e2e.sh

# Run pre-publish checks
bash scripts/pre-publish.sh

# Test in Docker (Node 20)
docker-compose -f docker-compose.test.yml up test-node20

# Create npm package locally
cd packages/movehat
npm pack

# Test local package
npm install -g movehat-*.tgz

# Dry run publish
npm publish --dry-run

# Actually publish
npm publish
```

---

## Best Practices

1. **Always test on clean install** - Users don't have your dev environment
2. **Test major Node versions** - Support LTS versions (18, 20)
3. **Use Docker for consistency** - Eliminates "works on my machine"
4. **Automate what you can** - CI/CD catches issues early
5. **Test the happy path** - Most users follow default flows
6. **Test error cases** - Graceful failures build trust
7. **Document breaking changes** - In CHANGELOG and migration guide
8. **Keep tests fast** - Developers won't run slow tests

---

## Troubleshooting Tests

### Smoke Tests Failing

```bash
# Clean and rebuild
pnpm clean
pnpm build:movehat

# Check package contents
cd packages/movehat
npm pack
tar -tzf movehat-*.tgz
```

### E2E Tests Failing

```bash
# Check Movement CLI
movement --version

# Check network connectivity
curl https://aptos.testnet.suzuka.movementlabs.xyz/v1

# Run with verbose logging
bash -x scripts/test-e2e.sh
```

### Docker Tests Failing

```bash
# Clean Docker cache
docker system prune -a

# Rebuild without cache
docker-compose -f docker-compose.test.yml build --no-cache

# Check Docker logs
docker-compose -f docker-compose.test.yml logs
```

---

**Ready to publish?** Follow the [Release Process](#release-process) above!
