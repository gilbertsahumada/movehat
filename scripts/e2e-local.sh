#!/bin/bash
set -e

# ===========================================
# MoveHat Local E2E Test
# ===========================================
# Fast E2E test that runs locally without Docker
# Simulates the full user journey from the README
# 
# Usage:
#   ./scripts/e2e-local.sh           # Run full E2E
#   ./scripts/e2e-local.sh --quick   # Quick mode (skip tests)
#   ./scripts/e2e-local.sh --keep    # Keep test dir for inspection
# ===========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse arguments
QUICK_MODE=false
KEEP_DIR=false
for arg in "$@"; do
    case $arg in
        --quick) QUICK_MODE=true ;;
        --keep) KEEP_DIR=true ;;
    esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test tracking
TESTS_PASSED=0
TESTS_FAILED=0
STEP=0

# Timing
START_TIME=$(date +%s)

# Helper functions
step() {
    STEP=$((STEP + 1))
    echo ""
    echo -e "${BLUE}[$STEP]${NC} $1"
    echo "─────────────────────────────────────────"
}

pass() {
    echo -e "${GREEN}✓${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo -e "${RED}✗${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

info() {
    echo -e "${YELLOW}→${NC} $1"
}

# Test directory
TEST_DIR="/tmp/movehat-e2e-$$"
PACKAGE_PATH=""

cleanup() {
    if [ "$KEEP_DIR" = false ]; then
        info "Cleaning up $TEST_DIR..."
        rm -rf "$TEST_DIR" 2>/dev/null || true
    else
        echo ""
        echo -e "${YELLOW}Test directory preserved:${NC} $TEST_DIR"
    fi
}

trap cleanup EXIT

# ===========================================
# Header
# ===========================================
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       MoveHat Local E2E Test Suite       ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Project: $PROJECT_ROOT"
echo "Test Dir: $TEST_DIR"
echo "Quick Mode: $QUICK_MODE"
echo ""

# ===========================================
# Prerequisites Check
# ===========================================
step "Checking prerequisites"

# Node.js
NODE_VERSION=$(node --version 2>/dev/null || echo "not installed")
NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d'.' -f1)
if [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then
    pass "Node.js $NODE_VERSION"
else
    fail "Node.js >= 18 required (found: $NODE_VERSION)"
    exit 1
fi

# pnpm
if command -v pnpm &> /dev/null; then
    pass "pnpm $(pnpm --version)"
else
    fail "pnpm not installed"
    exit 1
fi

# Movement CLI
if command -v movement &> /dev/null; then
    pass "Movement CLI $(movement --version 2>&1 | head -1)"
else
    fail "Movement CLI not installed"
    echo "Install from: https://docs.movementnetwork.xyz/devs/movementcli"
    exit 1
fi

# ===========================================
# Build MoveHat
# ===========================================
step "Building MoveHat from source"

cd "$PROJECT_ROOT"

# Run unit tests first
if [ "$QUICK_MODE" = false ]; then
    info "Running unit tests..."
    if pnpm test; then
        pass "Unit tests passed"
    else
        fail "Unit tests failed"
        exit 1
    fi
fi

# Build
info "Building package..."
if pnpm build:movehat > /dev/null 2>&1; then
    pass "Build successful"
else
    fail "Build failed"
    exit 1
fi

# ===========================================
# Create npm package
# ===========================================
step "Creating npm package (npm pack)"

cd "$PROJECT_ROOT/packages/movehat"

# Pack
PACKAGE_FILE=$(npm pack 2>/dev/null | tail -1)
if [ -n "$PACKAGE_FILE" ] && [ -f "$PACKAGE_FILE" ]; then
    PACKAGE_PATH="$PROJECT_ROOT/packages/movehat/$PACKAGE_FILE"
    pass "Created: $PACKAGE_FILE"
else
    fail "npm pack failed"
    exit 1
fi

# Verify package contents
info "Verifying package contents..."
REQUIRED_FILES=(
    "package/dist/index.js"
    "package/bin/movehat.js"
    "package/dist/templates"
)

for file in "${REQUIRED_FILES[@]}"; do
    if tar -tzf "$PACKAGE_PATH" | grep -q "$file"; then
        pass "Contains: $file"
    else
        fail "Missing: $file"
    fi
done

# ===========================================
# Install globally
# ===========================================
step "Installing CLI into an isolated global prefix"

mkdir -p "$TEST_DIR"
cp "$PACKAGE_PATH" "$TEST_DIR/"
cd "$TEST_DIR"

NPM_PREFIX="$TEST_DIR/npm-global"
mkdir -p "$NPM_PREFIX"
if npm install --global --prefix "$NPM_PREFIX" "$PACKAGE_FILE" > /dev/null 2>&1; then
    export PATH="$NPM_PREFIX/bin:$PATH"
    pass "Isolated CLI installation successful"
else
    fail "Isolated CLI installation failed"
    exit 1
fi

# Verify CLI is in PATH
if command -v movehat &> /dev/null; then
    VERSION=$(movehat --version)
    pass "CLI available: movehat v$VERSION"
else
    fail "movehat not in PATH"
    exit 1
fi

# ===========================================
# Test: movehat init my-project
# ===========================================
step "Testing: movehat init my-project"

cd "$TEST_DIR"

if movehat init my-project > /dev/null 2>&1; then
    pass "Project initialized"
else
    fail "Init failed"
    exit 1
fi

cd my-project

# Verify project structure (from README)
EXPECTED_FILES=(
    "move/Move.toml"
    "move/sources/Counter.move"
    "scripts/deploy-counter.ts"
    "tests/Counter.test.ts"
    "movehat.config.ts"
    "package.json"
    "tsconfig.json"
    ".env.example"
)

for file in "${EXPECTED_FILES[@]}"; do
    if [ -f "$file" ]; then
        pass "Created: $file"
    else
        fail "Missing: $file"
    fi
done

# ===========================================
# Test: install candidate tarball before dependency resolution
# ===========================================
step "Testing: npm install from candidate tarball"

SCAFFOLD_PIN=$(node -p "require('./package.json').dependencies.movehat")
if [ "$SCAFFOLD_PIN" = "$VERSION" ]; then
    pass "Scaffold pins the installed Movehat version exactly ($VERSION)"
else
    fail "Scaffold pins '$SCAFFOLD_PIN', expected '$VERSION'"
    exit 1
fi

# Install the candidate first. A plain `npm install` here would try to fetch
# the exact, not-yet-published version from the registry and deadlock releases.
if npm install --no-save "$PACKAGE_PATH" > /dev/null 2>&1; then
    pass "Dependencies installed with candidate tarball"
else
    fail "npm install of candidate tarball failed"
    exit 1
fi

if [ "$(node -p "require('./package.json').dependencies.movehat")" != "$VERSION" ]; then
    fail "Candidate install rewrote the exact Movehat pin"
    exit 1
fi
if [ "$(node -p "require('./node_modules/movehat/package.json').version")" != "$VERSION" ]; then
    fail "Installed Movehat version does not match candidate $VERSION"
    exit 1
fi

# Verify node_modules
if [ -d "node_modules" ] && [ -d "node_modules/movehat" ]; then
    pass "node_modules/movehat exists"
else
    fail "movehat not in node_modules"
fi

# ===========================================
# Test: npx movehat compile
# ===========================================
step "Testing: npx movehat compile"

# Should auto-detect named addresses
if npx movehat compile 2>&1; then
    pass "Compilation successful"
else
    fail "Compilation failed"
    exit 1
fi

# Verify build output
if [ -d "move/build" ]; then
    pass "Build directory created"
else
    info "Build directory not at expected location (checking alternatives...)"
fi

# ===========================================
# Test: Canonical deploy-counter.ts end-to-end against a local chain
# ===========================================
# Catches the class of bug where the template's deploy script is
# type-valid but fails at runtime (e.g., skipping a required `init`
# call). This is deliberately local and credential-free; public networks are
# opt-in and never belong in the deterministic install-experience gate.
#
# The step is NOT gated by --quick. The whole point of this gate is
# to run on every PR, since unit tests can't catch a missing init()
# in a template script.
step "Testing: canonical deploy-counter.ts against a local chain"

DEPLOY_LOG="$TEST_DIR/deploy.log"

if npx movehat run scripts/deploy-counter.ts > "$DEPLOY_LOG" 2>&1; then
    # Exit code 0 is necessary but not sufficient — assert the script
    # actually reached the final view-function call. The "Counter
    # value: 1" line is emitted only after deploy + init + increment
    # + view all succeed.
    if grep -q "Counter value: 1" "$DEPLOY_LOG"; then
        pass "Canonical deploy script succeeded end-to-end (deploy + init + increment + view)"
    else
        fail "Deploy script exited 0 but did not print 'Counter value: 1'"
        echo "--- deploy.log (tail) ---"
        tail -30 "$DEPLOY_LOG"
    fi
else
    fail "Canonical deploy-counter.ts failed at runtime"
    echo "--- deploy.log (tail) ---"
    tail -30 "$DEPLOY_LOG"
fi

# ===========================================
# Test: npm test (Move unit tests)
# ===========================================
if [ "$QUICK_MODE" = false ]; then
    step "Testing: movehat test --move"

    if npx movehat test --move 2>&1; then
        pass "Move unit tests passed"
    else
        fail "Move unit tests failed"
    fi
fi

# ===========================================
# Test: CLI help commands
# ===========================================
step "Testing CLI help commands"

COMMANDS=("--help" "compile --help" "test --help" "run --help" "fork --help")

for cmd in "${COMMANDS[@]}"; do
    if movehat $cmd > /dev/null 2>&1; then
        pass "movehat $cmd"
    else
        fail "movehat $cmd"
    fi
done

# ===========================================
# Test: Create and use fork
# ===========================================
if [ "$QUICK_MODE" = false ]; then
    step "Testing: Fork system"
    
    # Create fork
    if npx movehat fork create --network testnet --name test-fork 2>&1; then
        pass "Fork created"
    else
        info "Fork creation skipped (may require network)"
    fi
    
    # List forks
    if npx movehat fork list 2>&1; then
        pass "Fork list works"
    else
        fail "Fork list failed"
    fi
fi

# ===========================================
# Results Summary
# ===========================================
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║              Test Results                ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo -e "  Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "  Failed: ${RED}$TESTS_FAILED${NC}"
echo -e "  Duration: ${DURATION}s"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}═══════════════════════════════════════════${NC}"
    echo -e "${GREEN}  All E2E tests passed!                    ${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════${NC}"
    exit 0
else
    echo -e "${RED}═══════════════════════════════════════════${NC}"
    echo -e "${RED}  Some tests failed!                       ${NC}"
    echo -e "${RED}═══════════════════════════════════════════${NC}"
    exit 1
fi
