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
rm -rf "${PROJECT_DIR}"
movehat init "${PROJECT_DIR}" 2>&1 | tail -10
cd "${PROJECT_DIR}"
test -f move/sources/Counter.move || fail "Scaffold did not produce Counter.move"
test -f tests/Counter.test.ts || fail "Scaffold did not produce Counter.test.ts"
log "Project scaffolded at ${PROJECT_DIR}"

step "5/9 — Extend Counter with a user-authored reset() function"
# Inject `reset()` before the existing #[test(...)] annotation block.
# Validates that movehat's compile/test flow accepts user-authored
# changes to the template, not just the shipped template content.
python3 - <<'PYEOF'
import re
from pathlib import Path

p = Path("move/sources/Counter.move")
src = p.read_text()
reset_fn = '''
    public entry fun reset(account: &signer) acquires Counter {
        let account_addr = signer::address_of(account);
        assert!(exists<Counter>(account_addr), E_NOT_INITIALIZED);
        let counter = borrow_global_mut<Counter>(account_addr);
        counter.value = 0;
    }
'''
new_src = re.sub(r'(\n)(\s*#\[test\()', reset_fn + r'\1\2', src, count=1)
if new_src == src:
    raise SystemExit("FAIL: could not find #[test(...) annotation to inject reset() before. Template may have changed.")
p.write_text(new_src)
print(f"OK — reset() injected into Counter.move ({len(new_src)} bytes)")
PYEOF

# Append a TypeScript test that exercises reset()
cat >> tests/Counter.test.ts <<'TSEOF'

// Dogfood addition — validates the user-authored reset() function works
// end-to-end against a real local Movement node.
describe("Counter reset() — user-authored entry function", () => {
  it("alice can reset her counter back to 0 after incrementing", async () => {
    const alice = harness.runtime.getAccountByLabel("alice");

    // Initialize counter for alice
    await counter.call(alice, "init", []);

    // Increment twice
    await counter.call(alice, "increment", []);
    await counter.call(alice, "increment", []);

    let result = await harness.runViewFunction({
      function: `${counterAddr}::counter::get`,
      functionArguments: [alice.accountAddress.toString()],
    });
    expect(parseInt(result[0] as string)).to.equal(2);

    // Reset
    await counter.call(alice, "reset", []);

    result = await harness.runViewFunction({
      function: `${counterAddr}::counter::get`,
      functionArguments: [alice.accountAddress.toString()],
    });
    expect(parseInt(result[0] as string)).to.equal(0);
  });
});
TSEOF
log "Counter.move extended with reset()"
log "Counter.test.ts extended with reset() test"

step "6/9 — Install project dependencies"
npm install 2>&1 | tail -5

step "7/9 — Compile Move modules"
movehat compile 2>&1 | tail -10

step "8/9 — Run TypeScript tests against a real local Movement node"
# This spawns a real `movement node run-localnet`, funds the labeled
# accounts, autoDeploys counter, and runs the mocha suite (including the
# user-authored reset() test).
set +e
movehat test --ts 2>&1 | tee /tmp/dogfood-test.log
TEST_EXIT=${PIPESTATUS[0]}
set -e
test "${TEST_EXIT}" -eq 0 || fail "movehat test --ts exited ${TEST_EXIT}"
grep -qE "passing" /tmp/dogfood-test.log || fail "Mocha did not report a passing count"
PASS_COUNT=$(grep -oE "([0-9]+) passing" /tmp/dogfood-test.log | head -1 | grep -oE "^[0-9]+")
log "Tests passed: ${PASS_COUNT}"
test "${PASS_COUNT}" -ge 1 || fail "No tests passed"

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
echo "  - ${PASS_COUNT} mocha tests passed against real local node"
echo "  - Fork-mode read + write-rejection invariants validated"
echo "═══════════════════════════════════════════════════════"
