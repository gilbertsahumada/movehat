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
 * Prefers movelite when its binary is available: only the movelite
 * backend powers the Foundry-style execution traces shown at raised
 * verbosity (`movehat test --ts -vvvv`). Falls back to the full
 * Movement node on platforms without a movelite binary.
 */
export function getSharedNode() {
  if (!sharedNode || !sharedNode.isRunning()) {
    throw new Error(
      "Shared node not available. " +
        'Ensure tests/setup.ts is listed in .mocharc.json under "require".'
    );
  }
  return sharedNode;
}

export const mochaHooks = {
  async beforeAll() {
    this.timeout(60000);
    const moveliteBinary = findMoveliteBinary();
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
