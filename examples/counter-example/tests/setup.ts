import { LocalNodeManager } from "movehat/helpers";

let sharedNode: LocalNodeManager | undefined;

/**
 * Returns the shared local Movement node started by root hooks.
 * Pass the result as `{ localNode: getSharedNode() }` to
 * Harness.createLocal() or setupTestFixture().
 */
export function getSharedNode(): LocalNodeManager {
  if (!sharedNode || !sharedNode.isRunning()) {
    throw new Error(
      "Shared node not available. " +
        'Ensure tests/setup.ts is listed in .mocharc.json under "require".'
    );
  }
  return sharedNode;
}

export const mochaHooks = {
  async beforeAll(this: Mocha.Context) {
    this.timeout(60000);
    sharedNode = new LocalNodeManager({ forceRestart: true });
    await sharedNode.start();
  },

  async afterAll() {
    if (sharedNode) {
      await sharedNode.stop();
      sharedNode = undefined;
    }
  },
};
