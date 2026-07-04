import {
  LocalNodeManager,
  MoveliteManager,
  findMoveliteBinary,
  type NodeProvider,
} from "movehat/helpers";

let sharedNode: NodeProvider | undefined;

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
 */
export function getSharedNode(): NodeProvider {
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
