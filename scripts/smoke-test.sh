#!/bin/bash
set -e

# Smoke Test - Quick validation before publish
# Tests critical functionality only (runs in <30 seconds)

echo "🔥 Running Smoke Tests..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Detect project root BEFORE changing directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TEST_DIR="/tmp/movehat-smoke-test-$$"
mkdir -p "$TEST_DIR"

cleanup() {
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# Build
echo "→ Building package..."
cd "$PROJECT_ROOT/packages/movehat"
pnpm build > /dev/null 2>&1
echo -e "${GREEN}✓${NC} Build successful"

# Pack
echo "→ Packing package..."
npm pack > /dev/null 2>&1
PACKAGE=$(ls movehat-*.tgz | head -1)
echo -e "${GREEN}✓${NC} Package created: $PACKAGE"

# Move package to test directory
mv "$PACKAGE" "$TEST_DIR/"
cd "$TEST_DIR"

# Extract and check contents
echo "→ Checking package contents..."
tar -tzf "$PACKAGE" | grep -q "package/dist/index.js" || { echo -e "${RED}✗${NC} Missing dist/index.js"; exit 1; }
tar -tzf "$PACKAGE" | grep -q "package/bin/movehat.js" || { echo -e "${RED}✗${NC} Missing bin/movehat.js"; exit 1; }
tar -tzf "$PACKAGE" | grep -q "package/dist/templates" || { echo -e "${RED}✗${NC} Missing templates"; exit 1; }
echo -e "${GREEN}✓${NC} Package contents verified"

# Install globally
echo "→ Installing globally..."
npm install -g "$PACKAGE" > /dev/null 2>&1
echo -e "${GREEN}✓${NC} Global install successful"

# Test CLI
echo "→ Testing CLI commands..."
movehat --version > /dev/null || { echo -e "${RED}✗${NC} Version command failed"; exit 1; }
movehat --help > /dev/null || { echo -e "${RED}✗${NC} Help command failed"; exit 1; }
echo -e "${GREEN}✓${NC} CLI commands working"

# Quick init test
echo "→ Testing project initialization..."
cd "$TEST_DIR"
movehat init smoke-test > /dev/null 2>&1
cd smoke-test
[ -f "movehat.config.ts" ] || { echo -e "${RED}✗${NC} Config file missing"; exit 1; }
[ -f "move/Move.toml" ] || { echo -e "${RED}✗${NC} Move.toml missing"; exit 1; }
echo -e "${GREEN}✓${NC} Project initialization working"

echo ""
echo -e "${GREEN}🎉 All smoke tests passed!${NC}"
echo "Package is ready for publish."
