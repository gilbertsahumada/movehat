import type { MovehatRuntime } from "../types/runtime.js";
import type { LocalNodeManager } from "../node/LocalNodeManager.js";
import type { ForkServer } from "../fork/server.js";
import type { ForkManager } from "../fork/manager.js";
import type { LocalTestOptions } from "../types/config.js";
import { setupLocalTesting } from "../helpers/setupLocalTesting.js";
import { initRuntime } from "../runtime.js";
import { createHarnessProxy } from "./proxy.js";

export type HarnessMode = "local" | "fork" | "live";

interface HarnessInit {
  mode: HarnessMode;
  runtime: MovehatRuntime;
  localNode?: LocalNodeManager;
  forkServer?: ForkServer;
  forkManager?: ForkManager;
}

/**
 * Hardhat-style testing harness for Movehat.
 *
 * Construct via the static factories — `createLocal`, `createFork`,
 * `createLive` — never via `new Harness(...)`. The returned instance is
 * a Proxy that synchronously throws {@link HarnessDisposedError} on any
 * post-`cleanup()` call to one of the deployment / script / view methods.
 *
 * Methods `deployCodeObject`, `upgradeCodeObject`, `runViewFunction`,
 * and `runMoveScript` are stubbed in M2.1 — they throw at runtime until
 * M2.2/M2.3 lands. The type surface is complete so callers and docs can
 * be written against it ahead of time.
 *
 * AccountManager note: as of M2.1 the underlying account pool is a
 * process-wide static (see `core/AccountManager.ts`). Two Harness
 * instances in the same process share account labels; this is the same
 * constraint that already governs `setupTestFixture`. A per-Harness pool
 * is a future change.
 */
export class Harness {
  public readonly mode: HarnessMode;
  public readonly runtime: MovehatRuntime;

  /** @internal */
  public readonly localNode?: LocalNodeManager;
  /** @internal */
  public readonly forkServer?: ForkServer;
  /** @internal */
  public readonly forkManager?: ForkManager;

  private _poisoned = false;

  private constructor(init: HarnessInit) {
    this.mode = init.mode;
    this.runtime = init.runtime;
    if (init.localNode) this.localNode = init.localNode;
    if (init.forkServer) this.forkServer = init.forkServer;
    if (init.forkManager) this.forkManager = init.forkManager;
  }

  /** True once `cleanup()` has been awaited at least once. */
  public get poisoned(): boolean {
    return this._poisoned;
  }

  /**
   * Spin up a local Movement node and return a Harness bound to it.
   *
   * Forwards to `setupLocalTesting({ mode: 'local-node', ... })` so all
   * existing options (`nodeApiPort`, `accountLabels`, `autoDeploy`, ...)
   * apply unchanged.
   */
  static async createLocal(options: LocalTestOptions = {}): Promise<Harness> {
    const ctx = await setupLocalTesting({ ...options, mode: "local-node" });
    const init: HarnessInit = {
      mode: "local",
      runtime: ctx.runtime,
    };
    if (ctx.localNode) init.localNode = ctx.localNode;
    const instance = new Harness(init);
    return createHarnessProxy(instance, () => instance._poisoned);
  }

  /**
   * Create a fork-mode Harness reading from a snapshot of `network`.
   *
   * Fork mode is read-only: `deployCodeObject`, `upgradeCodeObject`, and
   * `runMoveScript` will throw with a message pointing at `createLocal`
   * once their real bodies land in M2.2/M2.3. `runViewFunction` works.
   *
   * @param network - Network to fork (e.g. `"testnet"`).
   * @param _apiKey - Reserved for M2.2; if non-undefined a TODO will fire.
   */
  static async createFork(network: string, _apiKey?: string): Promise<Harness> {
    if (_apiKey !== undefined) {
      // TODO(M2.2): plumb into MovementApiClient headers when the
      // fork manager needs authenticated upstream reads.
    }
    const ctx = await setupLocalTesting({ mode: "fork", forkNetwork: network });
    const init: HarnessInit = {
      mode: "fork",
      runtime: ctx.runtime,
    };
    if (ctx.forkServer) init.forkServer = ctx.forkServer;
    if (ctx.forkManager) init.forkManager = ctx.forkManager;
    const instance = new Harness(init);
    return createHarnessProxy(instance, () => instance._poisoned);
  }

  /**
   * Bind a Harness to a real running network (testnet, mainnet, or any
   * custom network defined in `movehat.config.ts`). No local process is
   * spawned; transactions are submitted to the configured RPC.
   *
   * @param network - Named network from movehat.config.ts.
   * @param _faucetUrl - Reserved for M2.2 (auto-fund on networks with a faucet).
   */
  static async createLive(network: string, _faucetUrl?: string): Promise<Harness> {
    const runtime = await initRuntime({ network });
    const instance = new Harness({ mode: "live", runtime });
    return createHarnessProxy(instance, () => instance._poisoned);
  }

  /**
   * Release resources owned by this harness (local node or fork server)
   * and poison it. Idempotent: subsequent calls are no-ops.
   *
   * After `cleanup()` resolves, any call to `deployCodeObject`,
   * `upgradeCodeObject`, `runViewFunction`, or `runMoveScript` throws
   * `HarnessDisposedError` synchronously on property access.
   */
  async cleanup(): Promise<void> {
    if (this._poisoned) return;
    this._poisoned = true;
    if (this.localNode) {
      await this.localNode.stop().catch(() => {});
    }
    if (this.forkServer) {
      await this.forkServer.stop().catch(() => {});
    }
  }

  // ---- Stubbed methods (real bodies land in M2.2 / M2.3) ----

  /** @stub M2.2 */
  async deployCodeObject(_options: unknown): Promise<unknown> {
    throw new Error("Harness.deployCodeObject is not yet implemented (M2.2).");
  }

  /** @stub M2.2 */
  async upgradeCodeObject(_options: unknown): Promise<unknown> {
    throw new Error("Harness.upgradeCodeObject is not yet implemented (M2.2).");
  }

  /** @stub M2.3 */
  async runViewFunction(_options: unknown): Promise<unknown> {
    throw new Error("Harness.runViewFunction is not yet implemented (M2.3).");
  }

  /** @stub M2.3 */
  async runMoveScript(_options: unknown): Promise<unknown> {
    throw new Error("Harness.runMoveScript is not yet implemented (M2.3).");
  }
}
