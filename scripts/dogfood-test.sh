#!/usr/bin/env bash
# scripts/dogfood-test.sh
#
# Tier B end-to-end dogfood test. Runs the full user journey:
#   1. Build + pack movehat from /workspace source
#   2. Install the tarball globally
#   3. Scaffold a new project via `movehat init`
#   4. Extend the template Counter module with a user-authored reset()
#      function and a matching test (proves the framework supports real
#      contributor edits, not just the canned template)
#   5. Compile with the real Movement CLI
#   6. Run mocha test suite against a real local Movement node spawned
#      by Harness.createLocal
#   7. Verify fork-mode invariants against testnet:
#      - createFork succeeds
#      - write attempts (deployCodeObject) are rejected
#      - post-cleanup poisoning works
#
# Intended to run inside Dockerfile.dogfood with the repo bind-mounted
# at /workspace. Invoke from the host via `pnpm docker:test:dogfood`.

set -euo pipefail

WORK_DIR="${WORK_DIR:-/workspace}"
PROJECT_DIR="${PROJECT_DIR:-/tmp/dogfood-project}"
SOURCE_PKG="${WORK_DIR}/packages/movehat"

step() { echo; echo "═══ $* ═══"; }
log()  { echo "  $*"; }
fail() { echo "DOGFOOD FAIL: $*" >&2; exit 1; }

step "1/9 — Verify environment"
node --version || fail "Node not installed"
movement --version || fail "Movement CLI not installed"
pnpm --version || fail "pnpm not installed"
log "node:     $(node --version)"
log "movement: $(movement --version)"
log "pnpm:     $(pnpm --version)"

step "2/9 — Build + pack movehat from source"
cd "${SOURCE_PKG}"
# Workspace install is heavy; rely on the host having already built dist/
# when possible, but reinstall + rebuild for full-from-scratch faithfulness.
cd "${WORK_DIR}"
pnpm install --frozen-lockfile 2>&1 | tail -3 || pnpm install 2>&1 | tail -3
pnpm build:movehat 2>&1 | tail -3
cd "${SOURCE_PKG}"
TARBALL=$(npm pack 2>&1 | tail -1)
TARBALL_PATH="${SOURCE_PKG}/${TARBALL}"
test -f "${TARBALL_PATH}" || fail "Tarball not produced: ${TARBALL_PATH}"
log "Packed: ${TARBALL}"

step "3/9 — Install movehat globally from the freshly-packed tarball"
npm install -g "${TARBALL_PATH}" 2>&1 | tail -3
command -v movehat >/dev/null || fail "movehat not on PATH after global install"
log "movehat version: $(movehat --version)"

step "4/9 — Scaffold a new project via movehat init"
# `movehat init <path>` accepts a full path; the Move package name is
# auto-derived from the basename and sanitized into a valid Move
# identifier. Without sanitization the path would leak verbatim into
# Move.toml and break compile with a cryptic "No such file or directory".
rm -rf "${PROJECT_DIR}"
movehat init "${PROJECT_DIR}" 2>&1 | tail -10
cd "${PROJECT_DIR}"
test -f move/sources/Counter.move || fail "Scaffold did not produce Counter.move"
test -f tests/Counter.test.ts || fail "Scaffold did not produce Counter.test.ts"
log "Project scaffolded at ${PROJECT_DIR}"

step "5/9 — Extend Counter with a user-authored reset() function + Move test"
# Inject `reset()` entry function AND a corresponding #[test] right
# before the existing test_increment annotation. Validates that
# movehat's compile/test flow accepts user-authored changes to the
# template, not just the shipped template content.
python3 - <<'PYEOF'
import re
from pathlib import Path

p = Path("move/sources/Counter.move")
src = p.read_text()
injection = '''
    public entry fun reset(account: &signer) acquires Counter {
        let account_addr = signer::address_of(account);
        assert!(exists<Counter>(account_addr), E_NOT_INITIALIZED);
        let counter = borrow_global_mut<Counter>(account_addr);
        counter.value = 0;
    }

    #[test(account = @0x1)]
    public fun test_reset(account: &signer) acquires Counter {
        let addr = signer::address_of(account);
        aptos_framework::account::create_account_for_test(addr);

        init(account);
        increment(account);
        increment(account);
        assert!(get(addr) == 2, 100);

        reset(account);
        assert!(get(addr) == 0, 101);
    }
'''
new_src = re.sub(r'(\n)(\s*#\[test\()', injection + r'\1\2', src, count=1)
if new_src == src:
    raise SystemExit("FAIL: could not find #[test(...) annotation to inject reset() before. Template may have changed.")
p.write_text(new_src)
print(f"OK — reset() entry fn + test_reset Move test injected ({len(new_src)} bytes)")
PYEOF
log "Counter.move extended with reset() + test_reset()"

step "6/9 — Install project dependencies"
npm install 2>&1 | grep -vE "^npm (warn|notice)" | head -30 || true

step "7/9 — Compile Move modules"
# Debug: dump the file state movehat compile will see (helps diagnose
# "No such file or directory" type errors which don't tell us which file).
echo "--- Move.toml ---"
cat move/Move.toml
echo "--- move/sources/Counter.move (head + tail) ---"
head -40 move/sources/Counter.move
echo "  ..."
tail -20 move/sources/Counter.move
echo "--- ls move/ ---"
ls -la move/ move/sources/
echo "--- compile output ---"
# Full output (no tail) so Move compiler errors are visible if any.
movehat compile 2>&1

step "8/9 — Run Move unit tests"
# We use --move (Move-level unit tests) rather than --ts because the
# `movement node run-local-testnet` path crashes on Linux x86_64 with
# the upstream MintFunder ENOT_APTOS_FRAMEWORK_ADDRESS bug (same one
# that gates harness-local in CI behind MOVEHAT_SKIP_LOCAL_NODE).
# Move tests exercise init + increment + reset semantics natively with
# no node spawn, so they're portable across all hosts. The TypeScript
# Harness.createLocal path is validated separately in the integration
# suite running on macOS hosts directly (no Rosetta).
set +e
movehat test --move 2>&1 | tee /tmp/dogfood-test.log
TEST_EXIT=${PIPESTATUS[0]}
set -e
test "${TEST_EXIT}" -eq 0 || fail "movehat test --move exited ${TEST_EXIT}"
grep -qE "Test result: OK" /tmp/dogfood-test.log || fail "Move tests did not report OK"
log "Move tests passed (includes user-authored test_reset)"

step "9/9 — Fork-mode validation (read-only + write rejection)"
cp "${WORK_DIR}/scripts/dogfood-fork-test.ts" scripts/dogfood-fork-test.ts
set +e
movehat run scripts/dogfood-fork-test.ts 2>&1 | tee /tmp/dogfood-fork.log
FORK_EXIT=${PIPESTATUS[0]}
set -e
test "${FORK_EXIT}" -eq 0 || fail "Fork test script exited ${FORK_EXIT}"
grep -q "FORK TEST PASSED" /tmp/dogfood-fork.log || fail "Fork test did not declare success"

echo
echo "═══════════════════════════════════════════════════════"
echo "  DOGFOOD TEST PASSED"
echo "  - Install + scaffold + user-authored Move edit + compile"
echo "  - Move unit tests passed (including test_reset)"
echo "  - Fork-mode read + write-rejection invariants validated"
echo "═══════════════════════════════════════════════════════"
