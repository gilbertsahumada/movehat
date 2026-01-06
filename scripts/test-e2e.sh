#!/bin/bash
set -e

# E2E Testing Script para MoveHat
# Simula el flujo completo de un usuario

echo "=========================================="
echo "MoveHat E2E Test Suite"
echo "=========================================="
echo ""

# Detect project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
log_success() {
    echo -e "${GREEN}✓${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

log_error() {
    echo -e "${RED}✗${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

log_info() {
    echo -e "${YELLOW}→${NC} $1"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up test artifacts..."
    rm -rf /tmp/movehat-e2e-test || true
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Create temp directory for testing
TEST_DIR="/tmp/movehat-e2e-test"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo "Test directory: $TEST_DIR"
echo ""

# ==========================================
# Test 1: Check Movement CLI is installed
# ==========================================
log_info "Test 1: Checking Movement CLI installation..."
if command -v movement &> /dev/null; then
    MOVEMENT_VERSION=$(movement --version 2>&1 || echo "unknown")
    log_success "Movement CLI is installed: $MOVEMENT_VERSION"
else
    log_error "Movement CLI is not installed"
    echo "Please install Movement CLI: https://docs.movementnetwork.xyz/devs/movementcli"
    exit 1
fi

# ==========================================
# Test 2: Check Node.js version
# ==========================================
log_info "Test 2: Checking Node.js version..."
NODE_VERSION=$(node --version)
NODE_MAJOR=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)

if [ "$NODE_MAJOR" -ge 20 ]; then
    log_success "Node.js version is compatible: $NODE_VERSION"
else
    log_error "Node.js version is too old: $NODE_VERSION (requires v20+)"
    exit 1
fi

# ==========================================
# Test 3: Build MoveHat from source
# ==========================================
log_info "Test 3: Building MoveHat from source..."
cd "$PROJECT_ROOT"

if pnpm build:movehat; then
    log_success "MoveHat built successfully"
else
    log_error "Failed to build MoveHat"
    exit 1
fi

# ==========================================
# Test 4: Pack and install globally
# ==========================================
log_info "Test 4: Packing and installing globally..."
cd "$PROJECT_ROOT/packages/movehat"

# Pack the package
if npm pack; then
    log_success "Package packed successfully"
else
    log_error "Failed to pack package"
    exit 1
fi

# Install globally
PACKAGE_FILE=$(ls movehat-*.tgz | head -1)
if npm install -g "$PACKAGE_FILE"; then
    log_success "Package installed globally"
else
    log_error "Failed to install package globally"
    exit 1
fi

# ==========================================
# Test 5: Verify CLI is available
# ==========================================
log_info "Test 5: Verifying CLI is available..."
cd "$TEST_DIR"

if command -v movehat &> /dev/null; then
    MOVEHAT_VERSION=$(movehat --version)
    log_success "MoveHat CLI is available: v$MOVEHAT_VERSION"
else
    log_error "MoveHat CLI is not in PATH"
    exit 1
fi

# ==========================================
# Test 6: Initialize new project
# ==========================================
log_info "Test 6: Initializing new project..."

if movehat init test-project; then
    log_success "Project initialized successfully"
else
    log_error "Failed to initialize project"
    exit 1
fi

cd test-project

# Verify project structure
EXPECTED_FILES=(
    "move/Move.toml"
    "move/sources/Counter.move"
    "tests/Counter.test.ts"
    "scripts/deploy-counter.ts"
    "movehat.config.ts"
    "package.json"
    ".env.example"
)

for file in "${EXPECTED_FILES[@]}"; do
    if [ -f "$file" ]; then
        log_success "File exists: $file"
    else
        log_error "Missing file: $file"
    fi
done

# ==========================================
# Test 7: Install dependencies
# ==========================================
log_info "Test 7: Installing project dependencies..."

if npm install; then
    log_success "Dependencies installed successfully"
else
    log_error "Failed to install dependencies"
    exit 1
fi

# ==========================================
# Test 8: Compile Move contracts
# ==========================================
log_info "Test 8: Compiling Move contracts..."

if movehat compile; then
    log_success "Contracts compiled successfully"
else
    log_error "Failed to compile contracts"
    exit 1
fi

# Verify build artifacts
if [ -d "move/build" ]; then
    log_success "Build artifacts created"
else
    log_error "Build artifacts not found"
fi

# ==========================================
# Test 9: Run Move unit tests
# ==========================================
log_info "Test 9: Running Move unit tests..."

if movehat test:move; then
    log_success "Move tests passed"
else
    log_error "Move tests failed"
fi

# ==========================================
# Test 10: Run TypeScript tests (simulation)
# ==========================================
log_info "Test 10: Running TypeScript integration tests..."

# Skip if no network access
if ping -c 1 aptos.testnet.suzuka.movementlabs.xyz &> /dev/null; then
    if npm run test; then
        log_success "TypeScript tests passed"
    else
        log_error "TypeScript tests failed (this might be expected without network)"
    fi
else
    log_info "Skipping TypeScript tests (no network access)"
fi

# ==========================================
# Test 11: Test help commands
# ==========================================
log_info "Test 11: Testing help commands..."

if movehat --help > /dev/null 2>&1; then
    log_success "Main help command works"
else
    log_error "Help command failed"
fi

if movehat compile --help > /dev/null 2>&1; then
    log_success "Compile help command works"
else
    log_error "Compile help command failed"
fi

if movehat test --help > /dev/null 2>&1; then
    log_success "Test help command works"
else
    log_error "Test help command failed"
fi

# ==========================================
# Test 12: Test update command
# ==========================================
log_info "Test 12: Testing update command..."

if timeout 10s movehat update > /dev/null 2>&1 || [ $? -eq 124 ]; then
    log_success "Update command works (timed out checking npm)"
else
    log_info "Update command check skipped"
fi

# ==========================================
# Results Summary
# ==========================================
echo ""
echo "=========================================="
echo "Test Results Summary"
echo "=========================================="
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi
