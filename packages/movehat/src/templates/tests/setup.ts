// @ts-nocheck - This is a template file, dependencies are installed in user projects
import {
  LocalNodeManager,
  MoveliteManager,
  findMoveliteBinary,
} from "movehat/helpers";

let sharedNode;

/**
 * Returns the shared local node started by root hooks.
 * Pass the result as `{ localNode: getSharedNode() }` to
 * Harness.createLocal() or setupTestFixture().
 *
 * Prefers movelite when its binary is available: only the movelite backend
 * exposes the /transactions/trace endpoint that powers the Foundry-style
 * execution traces you see at raised verbosity (`movehat test --ts -vvvv`).
 * When movelite is not installed (e.g. a platform without a published
 * binary) it falls back to the full Movement node, which still runs the
 * tests but renders only the degraded event/state trace.
 *
 * `MOVEHAT_USE_MOVELITE=0` forces the Movement-node fallback — the same
 * contract the framework's own backend auto-selection honors.
 */
export function getSharedNode() {
  if (!sharedNode || !sharedNode.isRunning()) {
    throw new Error(
      "Shared node not available — it either never started (ensure " +
        'tests/setup.ts is listed in .mocharc.json under "require") ' +
        "or stopped/crashed mid-run."
    );
  }
  return sharedNode;
}

export const mochaHooks = {
  async beforeAll() {
    this.timeout(60000);
    const moveliteBinary =
      process.env.MOVEHAT_USE_MOVELITE !== "0" ? findMoveliteBinary() : null;
    sharedNode = moveliteBinary
      ? new MoveliteManager(moveliteBinary)
      : new LocalNodeManager({ forceRestart: true });
    await sharedNode.start();
  },

  async afterAll() {
    if (sharedNode) {
      await sharedNode.stop();
      sharedNode = undefined;
    }
  },
};
