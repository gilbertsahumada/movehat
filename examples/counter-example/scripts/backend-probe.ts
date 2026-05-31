import { setupTestFixture } from "movehat/helpers";

/**
 * Backend probe for the assert-backend gate (movehat issue #302).
 *
 * Calls setupTestFixture WITHOUT a `localNode`, so setupLocalTesting takes
 * the auto-spawn branch and starts whichever backend it would for a real
 * user: movelite when a binary is detected (and not disabled via
 * `MOVEHAT_USE_MOVELITE=0`), otherwise the full Movement node.
 *
 * The gate (scripts/assert-backend.sh) runs this, captures stdout, and
 * asserts which backend's start line appeared plus how long boot took.
 * The "BACKEND-PROBE: ready" marker confirms the fixture came up.
 *
 * This is example-only test infrastructure; it is not part of the
 * `movehat init` scaffold.
 */
async function main() {
  const fixture = await setupTestFixture(["counter"] as const, ["deployer"]);
  console.log("BACKEND-PROBE: ready");
  await fixture.teardown();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
