#!/bin/bash
set -e

# ===========================================
# MoveHat offline fork e2e gate (issue #398)
# ===========================================
# Drives the real CLI against a checked-in, genuine MoveHat 0.6.0 fork
# directory (pre-migration layout: metadata + flat resource cache, no
# cache markers) and asserts:
#   1. `fork list` sees the legacy fork.
#   2. `fork view-resource` returns the pre-migration resource value and
#      the legacy-cache migration stamps its markers on the way.
#   3. `fork serve` boots, answers ledger-info and cached-resource reads
#      over HTTP with the expected JSON shape.
#
# Every asserted path is a local cache hit: no network access, no keys,
# deterministic — safe as a required CI gate.
#
# Inputs (env):
#   MOVEHAT_BIN     command used to invoke the CLI. Default: the repo's
#                   bin shim (requires `pnpm build:movehat` first). The
#                   e2e sandbox passes `movehat` (globally installed
#                   tarball) instead.
#   FORK_E2E_PORT   port for the fork server (default: 18080)
#
# Usage:
#   pnpm build:movehat && bash scripts/fork-e2e.sh
#   MOVEHAT_BIN=movehat bash scripts/fork-e2e.sh
# ===========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_DIR="$PROJECT_ROOT/packages/movehat/test/e2e/fixtures/fork-0.6.0"

MOVEHAT_BIN="${MOVEHAT_BIN:-node $PROJECT_ROOT/packages/movehat/bin/movehat.js}"
PORT="${FORK_E2E_PORT:-18080}"

ADDR="0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9"
RESOURCE="${ADDR}::counter::Counter"
RESOURCE_URLENC="${ADDR}%3A%3Acounter%3A%3ACounter"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

step() { echo ""; echo -e "${BLUE}→${NC} $1"; }
pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=1; }
info() { echo -e "${YELLOW}i${NC} $1"; }

FAILED=0
SERVER_PID=""

if [ ! -d "$FIXTURE_DIR" ]; then
    fail "Fixture not found: $FIXTURE_DIR"
    exit 2
fi
case "$MOVEHAT_BIN" in
    node\ *)
        if [ ! -f "$PROJECT_ROOT/packages/movehat/dist/index.js" ]; then
            fail "packages/movehat/dist is missing — run 'pnpm build:movehat' first (or set MOVEHAT_BIN)"
            exit 2
        fi
        ;;
esac

WORK="$(mktemp -d -t movehat-fork-e2e.XXXXXX)"
cleanup() {
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

# The first CLI touch mutates the fork (lazy cache generation + legacy
# migration markers), so always operate on a throwaway copy — never on
# the checked-in fixture.
FORK_PATH="$WORK/.movehat/forks/legacy-fork"
mkdir -p "$WORK/.movehat/forks"
cp -R "$FIXTURE_DIR" "$FORK_PATH"

# -------------------------------------------
step "fork list sees the legacy 0.6.0 fork"
# -------------------------------------------
LIST_LOG="$WORK/list.log"
LIST_RC=0
( cd "$WORK" && $MOVEHAT_BIN fork list ) > "$LIST_LOG" 2>&1 || LIST_RC=$?
if [ "$LIST_RC" -ne 0 ]; then
    fail "fork list exited $LIST_RC"
elif ! grep -q "Found 1 fork" "$LIST_LOG" || ! grep -q "testnet" "$LIST_LOG"; then
    fail "fork list output did not include the legacy fork"
else
    pass "fork list found the legacy fork"
fi
[ "$FAILED" -ne 0 ] && { echo "--- fork list log ---"; cat "$LIST_LOG"; }

# -------------------------------------------
step "fork view-resource migrates the legacy cache and serves the cached value"
# -------------------------------------------
VIEW_LOG="$WORK/view.log"
VIEW_RC=0
( cd "$WORK" && $MOVEHAT_BIN fork view-resource \
    --fork "$FORK_PATH" --account "$ADDR" --resource "$RESOURCE" ) > "$VIEW_LOG" 2>&1 || VIEW_RC=$?
if [ "$VIEW_RC" -ne 0 ]; then
    fail "fork view-resource exited $VIEW_RC"
    echo "--- view-resource log ---"; cat "$VIEW_LOG"
elif ! grep -q '"value": "999"' "$VIEW_LOG"; then
    fail "pre-migration resource value did not survive migration"
    echo "--- view-resource log ---"; cat "$VIEW_LOG"
else
    pass "cached resource value survived migration (value: 999)"
fi

# view-resource loads the fork, which must have run the 0.6 migration:
# per-address completeness marker first, global marker last.
for marker in ".resource-cache-v1" "$ADDR.all-resources" ".generation"; do
    if [ -f "$FORK_PATH/cache/$marker" ]; then
        pass "migration marker present: cache/$marker"
    else
        fail "migration marker missing: cache/$marker"
    fi
done

# -------------------------------------------
step "fork serve answers HTTP reads from the migrated cache"
# -------------------------------------------
SERVE_LOG="$WORK/serve.log"
( cd "$WORK" && exec $MOVEHAT_BIN fork serve --fork "$FORK_PATH" --port "$PORT" ) > "$SERVE_LOG" 2>&1 &
SERVER_PID=$!

READY=0
for _ in $(seq 1 50); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        break
    fi
    if curl -sf "http://127.0.0.1:$PORT/v1/" > /dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 0.2
done

if [ "$READY" -ne 1 ]; then
    fail "fork serve did not become ready on port $PORT"
    echo "--- fork serve log ---"; cat "$SERVE_LOG"
else
    pass "fork serve is listening on port $PORT"

    LEDGER_BODY="$WORK/ledger.json"
    LEDGER_STATUS=$(curl -s -o "$LEDGER_BODY" -w '%{http_code}' "http://127.0.0.1:$PORT/v1/")
    if [ "$LEDGER_STATUS" != "200" ] \
        || ! grep -q '"chain_id": 250' "$LEDGER_BODY" \
        || ! grep -q '"git_hash": "movehat-fork"' "$LEDGER_BODY"; then
        fail "GET /v1/ returned status $LEDGER_STATUS or unexpected body"
        echo "--- ledger body ---"; cat "$LEDGER_BODY"
    else
        pass "GET /v1/ returned the forked ledger info (chain_id: 250)"
    fi

    RES_BODY="$WORK/resource.json"
    RES_STATUS=$(curl -s -o "$RES_BODY" -w '%{http_code}' \
        "http://127.0.0.1:$PORT/v1/accounts/$ADDR/resource/$RESOURCE_URLENC")
    if [ "$RES_STATUS" != "200" ] \
        || ! grep -q "\"type\": \"$RESOURCE\"" "$RES_BODY" \
        || ! grep -q '"value": "999"' "$RES_BODY"; then
        fail "GET resource returned status $RES_STATUS or unexpected body"
        echo "--- resource body ---"; cat "$RES_BODY"
    else
        pass "GET resource returned 200 with the cached value (999)"
    fi
fi

# The serve command detaches its signal handlers once the server is up, so
# a plain kill terminates with the default 130/143 disposition — assert the
# process is gone, not its exit code.
if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    if kill -0 "$SERVER_PID" 2>/dev/null; then
        fail "fork serve process survived kill"
    else
        pass "fork serve stopped"
    fi
    SERVER_PID=""
fi

echo ""
if [ "$FAILED" -ne 0 ]; then
    fail "Fork e2e gate FAILED"
    exit 1
fi
pass "Fork e2e gate passed (migration + cached reads + serve, fully offline)"
