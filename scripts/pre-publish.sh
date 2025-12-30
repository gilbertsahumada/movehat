#!/bin/bash
set -e

# Pre-Publish Checklist Script
# Run this before publishing to npm

echo "=========================================="
echo "MoveHat Pre-Publish Checklist"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

CHECKS_PASSED=0
CHECKS_FAILED=0

check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
        ((CHECKS_PASSED++))
        return 0
    else
        echo -e "${RED}✗${NC} $1"
        ((CHECKS_FAILED++))
        return 1
    fi
}

echo -e "${BLUE}1. Checking Git Status${NC}"
echo "----------------------------------------"

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
    echo -e "${YELLOW}⚠${NC}  You have uncommitted changes"
    git status -s
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    check "No uncommitted changes"
fi

# Check current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $CURRENT_BRANCH"

if [[ "$CURRENT_BRANCH" != "main" ]] && [[ "$CURRENT_BRANCH" != "master" ]]; then
    echo -e "${YELLOW}⚠${NC}  Not on main/master branch"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo -e "${BLUE}2. Checking Package Version${NC}"
echo "----------------------------------------"

PACKAGE_VERSION=$(node -p "require('./packages/movehat/package.json').version")
echo "Package version: $PACKAGE_VERSION"

# Check if version tag exists
if git rev-parse "v$PACKAGE_VERSION" >/dev/null 2>&1; then
    echo -e "${RED}✗${NC} Version tag v$PACKAGE_VERSION already exists"
    echo "   Please bump version in package.json"
    exit 1
else
    check "Version tag v$PACKAGE_VERSION does not exist (good)"
fi

echo ""
echo -e "${BLUE}3. Running TypeScript Type Check${NC}"
echo "----------------------------------------"

cd packages/movehat
pnpm tsc --noEmit
check "TypeScript types are valid"

echo ""
echo -e "${BLUE}4. Building Package${NC}"
echo "----------------------------------------"

cd /test
pnpm build:movehat
check "Build successful"

echo ""
echo -e "${BLUE}5. Running Smoke Tests${NC}"
echo "----------------------------------------"

bash scripts/smoke-test.sh
check "Smoke tests passed"

echo ""
echo -e "${BLUE}6. Checking Package Size${NC}"
echo "----------------------------------------"

cd packages/movehat
PACKAGE_SIZE=$(npm pack --dry-run 2>&1 | grep "Unpacked size:" | awk '{print $3}')
echo "Package size: $PACKAGE_SIZE"

# Warn if package is too large (>10MB)
SIZE_BYTES=$(echo "$PACKAGE_SIZE" | grep -o '[0-9.]*' | head -1)
if (( $(echo "$SIZE_BYTES > 10" | bc -l) )); then
    echo -e "${YELLOW}⚠${NC}  Package size is large (>10MB)"
    echo "   Consider excluding unnecessary files"
else
    check "Package size is reasonable"
fi

echo ""
echo -e "${BLUE}7. Validating Package Contents${NC}"
echo "----------------------------------------"

# Check package.json fields
REQUIRED_FIELDS=("name" "version" "description" "author" "license" "repository" "keywords" "bin")
for field in "${REQUIRED_FIELDS[@]}"; do
    VALUE=$(node -p "require('./package.json').$field || 'MISSING'")
    if [[ "$VALUE" == "MISSING" ]] || [[ "$VALUE" == "undefined" ]]; then
        echo -e "${RED}✗${NC} Missing required field: $field"
        ((CHECKS_FAILED++))
    else
        echo -e "${GREEN}✓${NC} $field: $VALUE"
        ((CHECKS_PASSED++))
    fi
done

echo ""
echo -e "${BLUE}8. Checking Dependencies${NC}"
echo "----------------------------------------"

# Check for dev dependencies that should be dependencies
if node -p "Object.keys(require('./package.json').devDependencies || {}).filter(d => d.includes('@aptos-labs')).length" | grep -q "^[1-9]"; then
    echo -e "${YELLOW}⚠${NC}  Aptos SDK in devDependencies - should be in dependencies?"
fi

# Check for outdated dependencies (optional)
echo "Checking for outdated dependencies..."
npm outdated || true

echo ""
echo -e "${BLUE}9. Testing README${NC}"
echo "----------------------------------------"

if [ -f "README.md" ]; then
    check "README.md exists"

    # Check for required sections
    if grep -q "## Installation" README.md; then
        check "README has Installation section"
    else
        echo -e "${YELLOW}⚠${NC}  README missing Installation section"
    fi

    if grep -q "## Usage" README.md || grep -q "## Quick Start" README.md; then
        check "README has Usage/Quick Start section"
    else
        echo -e "${YELLOW}⚠${NC}  README missing Usage section"
    fi
else
    echo -e "${RED}✗${NC} README.md is missing"
    ((CHECKS_FAILED++))
fi

echo ""
echo -e "${BLUE}10. Checking npm credentials${NC}"
echo "----------------------------------------"

if npm whoami > /dev/null 2>&1; then
    NPM_USER=$(npm whoami)
    check "Logged into npm as: $NPM_USER"
else
    echo -e "${RED}✗${NC} Not logged into npm"
    echo "   Run: npm login"
    ((CHECKS_FAILED++))
fi

echo ""
echo "=========================================="
echo "Pre-Publish Summary"
echo "=========================================="
echo -e "Passed: ${GREEN}$CHECKS_PASSED${NC}"
echo -e "Failed: ${RED}$CHECKS_FAILED${NC}"
echo ""

if [ $CHECKS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "Ready to publish? Run:"
    echo -e "${BLUE}  cd packages/movehat${NC}"
    echo -e "${BLUE}  npm publish${NC}"
    echo ""
    echo "Or for a dry run:"
    echo -e "${BLUE}  npm publish --dry-run${NC}"
    exit 0
else
    echo -e "${RED}✗ Some checks failed. Please fix before publishing.${NC}"
    exit 1
fi
