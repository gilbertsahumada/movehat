import type { NodeProvider } from "../node/NodeProvider.js";
import type { LocalNodeInfo } from "../node/LocalNodeManager.js";

interface SharedNodeEntry {
  node: NodeProvider;
  startPromise: Promise<LocalNodeInfo>;
}

let shared: SharedNodeEntry | null = null;

/**
 * Returns the process-shared movelite node, booting it on first call.
 * Concurrent first callers await the same in-flight `start()`; a boot
 * failure propagates to every waiter and clears the memo so a later call
 * can retry. A memoized node that is no longer running (stopped through
 * the escape-hatch `localNode` handle) is discarded and replaced.
 *
 * Nothing ever stops the shared node: once ready it is unref'd, so the
 * event loop can drain, and the process-exit/signal hooks kill it.
 *
 * @internal
 */
export async function acquireSharedMoveliteNode(
  create: () => NodeProvider
): Promise<{ node: NodeProvider; nodeInfo: LocalNodeInfo }> {
  for (;;) {
    if (!shared) {
      const node = create();
      const entry: SharedNodeEntry = { node, startPromise: node.start() };
      shared = entry;
      try {
        const nodeInfo = await entry.startPromise;
        return { node, nodeInfo };
      } catch (error) {
        if (shared === entry) {
          shared = null;
        }
        throw error;
      }
    }

    const entry = shared;
    // No catch: a boot failure must reach every concurrent waiter; only
    // the creator (above) clears the memo.
    await entry.startPromise;
    if (shared !== entry) {
      continue;
    }
    if (!entry.node.isRunning()) {
      shared = null;
      continue;
    }
    // getNodeInfo() only after start resolved — the port may have moved
    // off the default during the boot's port probe.
    return { node: entry.node, nodeInfo: entry.node.getNodeInfo() };
  }
}

/**
 * Clears the memo without stopping the node.
 *
 * @internal test-only
 */
export function _resetSharedMoveliteNode(): void {
  shared = null;
}
