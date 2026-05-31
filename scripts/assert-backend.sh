#!/bin/bash
set -e

# ===========================================
# MoveHat backend-assertion gate (issue #302)
# ===========================================
# Runs the counter-example backend probe (which hits the auto-spawn path)
# and fails if the wrong local-test backend started, or if it took too long.
# Guards against silent regressions where the movelite fast-path stops
# firing and every consumer falls back to the slow Movement node with all
# other gates still green.
#
# The primary guard is backend IDENTITY (which start line appeared). The
# time ceiling is a corroborating signal: the probe measures the full
# fixture-ready wall-clock (backend boot + Move compile + deploy), not pure
# boot, so the movelite ceiling is set well above the real compile+deploy
# cost yet far below the ~90s a fallback to the Movement node would take.
#
# Inputs (env):
#   MOVEHAT_EXPECT_BACKEND       movelite | movement-node   (required)
#   MOVEHAT_EXPECT_BOOT_MAX_MS   fixture-ready ceiling in ms
#                                (default: 20000 movelite, 90000 movement-node)
#
# Usage:
#   MOVEHAT_EXPECT_BACKEND=movelite      bash scripts/assert-backend.sh
#   MOVEHAT_EXPECT_BACKEND=movement-node bash scripts/assert-backend.sh
# ===========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLE_DIR="$PROJECT_ROOT/examples/counter-example"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

step() { echo ""; echo -e "${BLUE}→${NC} $1"; }
pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${YELLOW}i${NC} $1"; }

MOVELITE_LINE="Starting movelite..."
MOVEMENT_LINE="Starting local Movement node"

EXPECT="${MOVEHAT_EXPECT_BACKEND:-}"
case "$EXPECT" in
    movelite)
        EXPECT_LINE="$MOVELITE_LINE"
        DEFAULT_MAX_MS=20000
        FORCE_MOVELITE=1
        ;;
    movement-node)
        EXPECT_LINE="$MOVEMENT_LINE"
        DEFAULT_MAX_MS=90000
        FORCE_MOVELITE=0
        ;;
    *)
        fail "MOVEHAT_EXPECT_BACKEND must be 'movelite' or 'movement-node' (got: '${EXPECT:-unset}')"
        exit 2
        ;;
esac
MAX_MS="${MOVEHAT_EXPECT_BOOT_MAX_MS:-$DEFAULT_MAX_MS}"

step "Asserting local-test backend: expect '$EXPECT' within ${MAX_MS}ms"
info "Running backend probe (MOVEHAT_USE_MOVELITE=$FORCE_MOVELITE)"

LOG="$(mktemp -t movehat-backend-probe.XXXXXX)"
trap 'rm -f "$LOG"' EXIT

START_MS=$(node -e 'process.stdout.write(String(Date.now()))')
PROBE_RC=0
( cd "$EXAMPLE_DIR" && MOVEHAT_USE_MOVELITE="$FORCE_MOVELITE" \
    npx movehat run scripts/backend-probe.ts ) > "$LOG" 2>&1 || PROBE_RC=$?
END_MS=$(node -e 'process.stdout.write(String(Date.now()))')
ELAPSED_MS=$((END_MS - START_MS))

# Which backend actually started?
ACTUAL="unknown"
if grep -qF "$MOVELITE_LINE" "$LOG"; then
    ACTUAL="movelite"
elif grep -qF "$MOVEMENT_LINE" "$LOG"; then
    ACTUAL="movement-node"
fi

FAILED=0

if [ "$PROBE_RC" -ne 0 ] || ! grep -qF "BACKEND-PROBE: ready" "$LOG"; then
    fail "Probe did not reach 'BACKEND-PROBE: ready' (exit $PROBE_RC)"
    FAILED=1
fi

if [ "$ACTUAL" != "$EXPECT" ]; then
    fail "Backend mismatch: expected '$EXPECT', actually started '$ACTUAL'"
    info "The line '$EXPECT_LINE' was not the backend that booted."
    FAILED=1
else
    pass "Backend matched: '$ACTUAL'"
fi

if [ "$ELAPSED_MS" -gt "$MAX_MS" ]; then
    fail "Boot too slow: ${ELAPSED_MS}ms > ${MAX_MS}ms (MOVEHAT_EXPECT_BOOT_MAX_MS)"
    FAILED=1
else
    pass "Boot within budget: ${ELAPSED_MS}ms <= ${MAX_MS}ms"
fi

if [ "$FAILED" -ne 0 ]; then
    echo ""
    fail "Backend assertion FAILED (expected=$EXPECT actual=$ACTUAL boot=${ELAPSED_MS}ms ceiling=${MAX_MS}ms)"
    echo "--- probe log (tail) ---"
    tail -30 "$LOG"
    exit 1
fi

echo ""
pass "Backend assertion passed (backend=$ACTUAL boot=${ELAPSED_MS}ms)"
