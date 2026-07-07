#!/bin/bash
set -e

# Pre-Publish Checklist Script
# We Run this before publishing to npm
#
# Usage: bash scripts/pre-publish.sh [--non-interactive]
#   --non-interactive (or CI=true): never prompt; any condition that would
#   have asked "Continue anyway?" fails immediately instead.

# Detect project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NON_INTERACTIVE=0
if [[ "${1:-}" == "--non-interactive" ]] || [[ "${CI:-}" == "true" ]]; then
    NON_INTERACTIVE=1
fi

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

# Explicit pass/fail markers. Never inspect $? here: at else-branch call
# sites $? is the exit status of the just-failed `if` condition, which made
# the old check() print a false ✗ and abort under `set -e` on the exact
# path where everything was fine. Both helpers return 0 so failures
# accumulate to the summary, which exits 1 when any check failed.
check_ok() {
    echo -e "${GREEN}✓${NC} $1"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    CHECKS_FAILED=$((CHECKS_FAILED + 1))
}

echo -e "${BLUE}1. Checking Git Status${NC}"
echo "----------------------------------------"

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
    echo -e "${YELLOW}⚠${NC}  You have uncommitted changes"
    git status -s
    echo ""
    if [[ $NON_INTERACTIVE -eq 1 ]]; then
        echo -e "${RED}✗${NC} Uncommitted changes (non-interactive mode refuses to continue)"
        exit 1
    fi
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    check_ok "No uncommitted changes"
fi

# Check current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $CURRENT_BRANCH"

if [[ "$CURRENT_BRANCH" != "main" ]] && [[ "$CURRENT_BRANCH" != "master" ]]; then
    echo -e "${YELLOW}⚠${NC}  Not on main/master branch"
    if [[ $NON_INTERACTIVE -eq 1 ]]; then
        echo -e "${RED}✗${NC} Not on main/master (non-interactive mode refuses to continue)"
        exit 1
    fi
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
    check_ok "Version tag v$PACKAGE_VERSION does not exist (good)"
fi

echo ""
echo -e "${BLUE}3. Running TypeScript Type Check${NC}"
echo "----------------------------------------"

cd packages/movehat
pnpm tsc --noEmit
check_ok "TypeScript types are valid"

echo ""
echo -e "${BLUE}4. Building Package${NC}"
echo "----------------------------------------"

cd "$PROJECT_ROOT"
pnpm build:movehat
check_ok "Build successful"

echo ""
echo -e "${BLUE}5. Running Smoke Tests${NC}"
echo "----------------------------------------"

bash scripts/smoke-test.sh
check_ok "Smoke tests passed"

echo ""
echo -e "${BLUE}5b. Running Tier 3 Install-Experience E2E${NC}"
echo "----------------------------------------"
# The install-experience E2E packs movehat into a
# tarball, installs it globally, and exercises `movehat init`, `movehat
# test --move`, and the fork system end-to-end. This is the last chance
# to catch packaging regressions (missing dist files, broken exports,
# stale templates) before the artifact reaches npm users.
bash scripts/e2e-local.sh
check_ok "Install-experience E2E passed"

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
    check_ok "Package size is reasonable"
fi

echo ""
echo -e "${BLUE}7. Validating Package Contents${NC}"
echo "----------------------------------------"

# Check package.json fields
REQUIRED_FIELDS=("name" "version" "description" "author" "license" "repository" "keywords" "bin")
for field in "${REQUIRED_FIELDS[@]}"; do
    VALUE=$(node -p "require('./package.json').$field || 'MISSING'")
    if [[ "$VALUE" == "MISSING" ]] || [[ "$VALUE" == "undefined" ]]; then
        check_fail "Missing required field: $field"
    else
        check_ok "$field: $VALUE"
    fi
done

echo ""
echo -e "${BLUE}8. Checking Dependencies${NC}"
echo "----------------------------------------"

# Check for dev dependencies that should be dependencies
if node -p "Object.keys(require('./package.json').devDependencies || {}).filter(d => d.includes('@aptos-labs')).length" | grep -q "^[1-9]"; then
    echo -e "${YELLOW}⚠${NC}  Movement TypeScript SDK in devDependencies - should be in dependencies?"
fi

# Check for outdated dependencies (optional)
echo "Checking for outdated dependencies..."
npm outdated || true

echo ""
echo -e "${BLUE}9. Testing README${NC}"
echo "----------------------------------------"

if [ -f "README.md" ]; then
    check_ok "README.md exists"

    # Check for required sections
    if grep -q "## Installation" README.md; then
        check_ok "README has Installation section"
    else
        echo -e "${YELLOW}⚠${NC}  README missing Installation section"
    fi

    if grep -q "## Usage" README.md || grep -q "## Quick Start" README.md; then
        check_ok "README has Usage/Quick Start section"
    else
        echo -e "${YELLOW}⚠${NC}  README missing Usage section"
    fi
else
    check_fail "README.md is missing"
fi

echo ""
echo -e "${BLUE}10. Checking npm credentials${NC}"
echo "----------------------------------------"

# Informational only: the real publish runs in CI (publish.yml, triggered by
# a GitHub Release) via OIDC/Trusted Publishers and needs no local login.
# Local credentials matter only for a manual `npm publish` fallback.
if npm whoami > /dev/null 2>&1; then
    NPM_USER=$(npm whoami)
    check_ok "Logged into npm as: $NPM_USER"
else
    echo -e "${YELLOW}⚠${NC}  Not logged into npm (fine: publish runs via OIDC in CI; needed only for manual npm publish)"
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
    echo "Ready to publish? Create the GitHub Release (publish.yml pushes to npm via OIDC):"
    echo -e "${BLUE}  gh release create v$PACKAGE_VERSION --target main --title \"v$PACKAGE_VERSION\"${NC}"
    echo ""
    echo "Or publish manually (requires npm login):"
    echo -e "${BLUE}  cd packages/movehat && npm publish${NC}"
    exit 0
else
    echo -e "${RED}✗ Some checks failed. Please fix before publishing.${NC}"
    exit 1
fi
