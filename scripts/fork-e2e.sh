#!/bin/bash
set -e

# ===========================================
# MoveHat offline fork e2e gate (issue #398)
# ===========================================
# Drives the real CLI against a checked-in, genuine MoveHat 0.6.0 fork
# directory (pre-migration layout: metadata + flat resource cache, no
# cache markers) and asserts:
#   1. `fork list` sees the legacy fork.
#   2. `fork view-resource` preserves the pre-migration resource value.
#   3. Migration markers are bound to one valid cache generation.
#   4. `fork serve` answers singular and plural cached-resource reads.
#   5. A local sentinel receives zero upstream requests throughout.
#
# Inputs (env):
#   MOVEHAT_BIN     executable used to invoke the CLI. Default: the repo's
#                   bin shim through Node. The e2e sandbox passes `movehat`.
#   FORK_E2E_PORT   optional validated fork-server port. When omitted, a
#                   free loopback port is allocated dynamically.
#
# Usage:
#   pnpm build:movehat && bash scripts/fork-e2e.sh
#   MOVEHAT_BIN=movehat bash scripts/fork-e2e.sh
# ===========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_DIR="$PROJECT_ROOT/packages/movehat/test/e2e/fixtures/fork-0.6.0"

if [ -n "${MOVEHAT_BIN:-}" ]; then
    MOVEHAT_CMD=("$MOVEHAT_BIN")
else
    MOVEHAT_CMD=(node "$PROJECT_ROOT/packages/movehat/bin/movehat.js")
fi

ADDR="0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9"
RESOURCE="${ADDR}::counter::Counter"
RESOURCE_URLENC="${ADDR}%3A%3Acounter%3A%3ACounter"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

step() { echo ""; echo -e "${BLUE}→${NC} $1"; }
pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=1; }

FAILED=0
SERVER_PID=""
SENTINEL_PID=""

run_movehat() {
    "${MOVEHAT_CMD[@]}" "$@"
}

normalize_port() {
    node -e '
      const raw = process.argv[1];
      const port = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535) {
        process.exit(1);
      }
      process.stdout.write(String(port));
    ' "$1"
}

allocate_port() {
    node -e '
      const net = require("node:net");
      const server = net.createServer();
      server.once("error", () => process.exit(1));
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        server.close(() => process.stdout.write(String(address.port)));
      });
    '
}

port_is_available() {
    node -e '
      const net = require("node:net");
      const server = net.createServer();
      server.once("error", () => process.exit(1));
      server.listen(Number(process.argv[1]), "127.0.0.1", () => {
        server.close(() => process.exit(0));
      });
    ' "$1"
}

# Returns 0 for a normal stop, 2 when SIGKILL was required, and 1 if the
# process somehow remains alive. No wait is issued until exit is observed or
# SIGKILL has been sent, so cleanup cannot block indefinitely.
stop_process() {
    local pid="$1"
    if [ -z "$pid" ]; then
        return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
        wait "$pid" 2>/dev/null || true
        return 0
    fi

    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 30); do
        if ! kill -0 "$pid" 2>/dev/null; then
            wait "$pid" 2>/dev/null || true
            return 0
        fi
        sleep 0.1
    done

    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    if kill -0 "$pid" 2>/dev/null; then
        return 1
    fi
    return 2
}

assert_json() {
    node "$SCRIPT_DIR/fork-e2e-assert-json.mjs" "$1" "$2" "$RESOURCE"
}

assert_no_upstream_hits() {
    local stage="$1"
    if [ -s "$SENTINEL_HITS" ]; then
        fail "Unexpected upstream request during $stage"
        echo "--- sentinel requests ---"
        cat "$SENTINEL_HITS"
        return 1
    fi
    pass "No upstream requests during $stage"
    return 0
}

if [ ! -d "$FIXTURE_DIR" ]; then
    fail "Fixture not found: $FIXTURE_DIR"
    exit 2
fi
if [ -z "${MOVEHAT_BIN:-}" ] && [ ! -f "$PROJECT_ROOT/packages/movehat/dist/index.js" ]; then
    fail "packages/movehat/dist is missing — run 'pnpm build:movehat' first (or set MOVEHAT_BIN)"
    exit 2
fi

if [ -n "${FORK_E2E_PORT:-}" ]; then
    if ! PORT="$(normalize_port "$FORK_E2E_PORT")"; then
        fail "FORK_E2E_PORT must be an integer between 1 and 65535"
        exit 2
    fi
else
    PORT="$(allocate_port)"
fi
if ! port_is_available "$PORT"; then
    fail "Fork server port $PORT is already in use"
    exit 2
fi

WORK="$(mktemp -d -t movehat-fork-e2e.XXXXXX)"
cleanup() {
    stop_process "$SERVER_PID" || true
    stop_process "$SENTINEL_PID" || true
    rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

# The first CLI touch mutates the fork (lazy cache generation + legacy
# migration markers), so always operate on a throwaway copy — never on
# the checked-in fixture.
FORK_PATH="$WORK/.movehat/forks/legacy-fork"
mkdir -p "$WORK/.movehat/forks"
cp -R "$FIXTURE_DIR" "$FORK_PATH"

# Point only the throwaway copy at a sentinel that deliberately returns the
# same value as the fixture. Output assertions alone could therefore pass on
# a cache regression; the zero-hit assertions below make that impossible.
SENTINEL_READY="$WORK/sentinel.port"
SENTINEL_HITS="$WORK/sentinel.hits"
SENTINEL_LOG="$WORK/sentinel.log"
node "$SCRIPT_DIR/fork-e2e-sentinel.mjs" \
    "$SENTINEL_READY" "$SENTINEL_HITS" "$RESOURCE" > "$SENTINEL_LOG" 2>&1 &
SENTINEL_PID=$!

SENTINEL_STARTED=0
for _ in $(seq 1 50); do
    if ! kill -0 "$SENTINEL_PID" 2>/dev/null; then
        break
    fi
    if [ -s "$SENTINEL_READY" ]; then
        SENTINEL_STARTED=1
        break
    fi
    sleep 0.1
done
if [ "$SENTINEL_STARTED" -ne 1 ]; then
    fail "Offline sentinel did not become ready"
    echo "--- sentinel log ---"; cat "$SENTINEL_LOG"
    exit 1
fi
if ! SENTINEL_PORT="$(normalize_port "$(cat "$SENTINEL_READY")")"; then
    fail "Offline sentinel reported an invalid port"
    exit 1
fi

node - "$FORK_PATH/metadata.json" "$SENTINEL_PORT" <<'NODE'
const fs = require('node:fs');
const [path, port] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(path, 'utf8'));
metadata.nodeUrl = `http://127.0.0.1:${port}/v1`;
fs.writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`);
NODE

# -------------------------------------------
step "fork list sees the legacy 0.6.0 fork"
# -------------------------------------------
LIST_LOG="$WORK/list.log"
LIST_RC=0
( cd "$WORK" && run_movehat fork list ) > "$LIST_LOG" 2>&1 || LIST_RC=$?
if [ "$LIST_RC" -ne 0 ]; then
    fail "fork list exited $LIST_RC"
elif ! grep -q "Found 1 fork" "$LIST_LOG" || ! grep -q "testnet" "$LIST_LOG"; then
    fail "fork list output did not include the legacy fork"
else
    pass "fork list found the legacy fork"
fi
if [ "$FAILED" -ne 0 ]; then
    echo "--- fork list log ---"; cat "$LIST_LOG"
fi
if ! assert_no_upstream_hits "fork list"; then exit 1; fi

# -------------------------------------------
step "fork view-resource migrates the cache and serves the cached value"
# -------------------------------------------
VIEW_LOG="$WORK/view.log"
VIEW_RC=0
( cd "$WORK" && run_movehat fork view-resource \
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
if ! assert_no_upstream_hits "fork view-resource"; then exit 1; fi

# The migration marker is an existence flag. The generation and per-address
# completeness marker carry the semantic generation contract.
if [ -f "$FORK_PATH/cache/.resource-cache-v1" ]; then
    pass "migration marker present: cache/.resource-cache-v1"
else
    fail "migration marker missing: cache/.resource-cache-v1"
fi

GENERATION=""
if [ -f "$FORK_PATH/cache/.generation" ]; then
    GENERATION="$(tr -d '\r\n' < "$FORK_PATH/cache/.generation")"
fi
if [[ "$GENERATION" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]; then
    pass "cache/.generation contains a valid UUID"
else
    fail "cache/.generation is missing or invalid"
fi

ADDRESS_MARKER="$FORK_PATH/cache/$ADDR.all-resources"
ADDRESS_MARKER_VALUE=""
if [ -f "$ADDRESS_MARKER" ]; then
    ADDRESS_MARKER_VALUE="$(tr -d '\r\n' < "$ADDRESS_MARKER")"
fi
if [ -n "$GENERATION" ] && [ "$ADDRESS_MARKER_VALUE" = "generation:$GENERATION" ]; then
    pass "per-address marker matches cache generation"
else
    fail "per-address marker is missing or generation-mismatched"
fi

# -------------------------------------------
step "fork serve answers exact HTTP shapes from the migrated cache"
# -------------------------------------------
SERVE_LOG="$WORK/serve.log"
( cd "$WORK" && exec "${MOVEHAT_CMD[@]}" fork serve \
    --fork "$FORK_PATH" --port "$PORT" ) > "$SERVE_LOG" 2>&1 &
SERVER_PID=$!

READY=0
for _ in $(seq 1 50); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        break
    fi
    if grep -Fq "Fork Server listening on http://127.0.0.1:$PORT" "$SERVE_LOG" \
        && curl -sf --max-time 2 "http://127.0.0.1:$PORT/v1/" > /dev/null 2>&1 \
        && kill -0 "$SERVER_PID" 2>/dev/null; then
        READY=1
        break
    fi
    sleep 0.2
done

if [ "$READY" -ne 1 ]; then
    fail "fork serve did not become ready on owned port $PORT"
    echo "--- fork serve log ---"; cat "$SERVE_LOG"
else
    pass "fork serve owns and is listening on port $PORT"

    LEDGER_BODY="$WORK/ledger.json"
    LEDGER_STATUS="000"
    if ! LEDGER_STATUS=$(curl -sS --max-time 2 -o "$LEDGER_BODY" -w '%{http_code}' \
        "http://127.0.0.1:$PORT/v1/"); then
        fail "GET /v1/ failed"
    elif [ "$LEDGER_STATUS" != "200" ] || ! assert_json ledger "$LEDGER_BODY"; then
        fail "GET /v1/ returned status $LEDGER_STATUS or an unexpected body"
        echo "--- ledger body ---"; cat "$LEDGER_BODY"
    else
        pass "GET /v1/ returned the exact forked ledger shape"
    fi

    RES_BODY="$WORK/resource.json"
    RES_STATUS="000"
    if ! RES_STATUS=$(curl -sS --max-time 2 -o "$RES_BODY" -w '%{http_code}' \
        "http://127.0.0.1:$PORT/v1/accounts/$ADDR/resource/$RESOURCE_URLENC"); then
        fail "GET resource failed"
    elif [ "$RES_STATUS" != "200" ] || ! assert_json resource "$RES_BODY"; then
        fail "GET resource returned status $RES_STATUS or an unexpected body"
        echo "--- resource body ---"; cat "$RES_BODY"
    else
        pass "GET resource returned the exact resource shape"
    fi

    ALL_RES_BODY="$WORK/resources.json"
    ALL_RES_STATUS="000"
    if ! ALL_RES_STATUS=$(curl -sS --max-time 2 -o "$ALL_RES_BODY" -w '%{http_code}' \
        "http://127.0.0.1:$PORT/v1/accounts/$ADDR/resources"); then
        fail "GET resources failed"
    elif [ "$ALL_RES_STATUS" != "200" ] || ! assert_json resources "$ALL_RES_BODY"; then
        fail "GET resources returned status $ALL_RES_STATUS or an unexpected body"
        echo "--- resources body ---"; cat "$ALL_RES_BODY"
    else
        pass "GET resources returned the exact resource-array shape"
    fi
fi

if ! assert_no_upstream_hits "fork serve HTTP reads"; then exit 1; fi

STOP_RC=0
stop_process "$SERVER_PID" || STOP_RC=$?
SERVER_PID=""
if [ "$STOP_RC" -eq 0 ]; then
    pass "fork serve stopped within 3 seconds"
elif [ "$STOP_RC" -eq 2 ]; then
    fail "fork serve required SIGKILL after the 3-second shutdown deadline"
else
    fail "fork serve survived SIGKILL"
fi

SENTINEL_STOP_RC=0
stop_process "$SENTINEL_PID" || SENTINEL_STOP_RC=$?
SENTINEL_PID=""
if [ "$SENTINEL_STOP_RC" -ne 0 ]; then
    fail "offline sentinel did not stop cleanly"
fi

echo ""
if [ "$FAILED" -ne 0 ]; then
    fail "Fork e2e gate FAILED"
    exit 1
fi
pass "Fork e2e gate passed (migration + cached reads + serve, zero upstream requests)"
