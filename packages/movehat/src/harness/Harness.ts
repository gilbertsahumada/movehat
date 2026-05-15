import type { MovehatRuntime } from "../types/runtime.js";
import type { LocalNodeManager } from "../node/LocalNodeManager.js";
import type { ForkServer } from "../fork/server.js";
import type { ForkManager } from "../fork/manager.js";
import type { LocalTestOptions } from "../types/config.js";
import type {
  DeployCodeObjectOptions,
  UpgradeCodeObjectOptions,
  CodeObjectInfo,
  RunViewFunctionOptions,
  RunMoveScriptOptions,
  MoveScriptResult,
} from "../types/harness.js";
import { setupLocalTesting } from "../helpers/setupLocalTesting.js";
import { initRuntime } from "../runtime.js";
import { createHarnessProxy } from "./proxy.js";
import { deployCodeObject, upgradeCodeObject } from "./codeObject.js";
import { runViewFunction } from "./view.js";
import { runMoveScript } from "./script.js";

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
 * AccountManager note: the underlying account pool is a process-wide
 * static (see `core/AccountManager.ts`). Two Harness instances in the
 * same process share account labels; this is the same constraint that
 * already governs `setupTestFixture`.
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
   * Fork mode is read-only: `deployCodeObject`, `upgradeCodeObject`,
   * and `runMoveScript` throw with a message pointing at `createLocal`.
   * `runViewFunction` works (read-only path).
   *
   * @param network - Network to fork (e.g. `"testnet"`).
   * @param apiKey - Optional Movement API key. When set, every upstream
   *   request from the fork's `MovementApiClient` carries
   *   `Authorization: Bearer <apiKey>`. Use for rate-limited public
   *   endpoints or auth-gated nodes. The key stays in process memory
   *   (not persisted to the fork's on-disk metadata).
   */
  static async createFork(network: string, apiKey?: string): Promise<Harness> {
    const setupOpts: import("../types/config.js").LocalTestOptions = {
      mode: "fork",
      forkNetwork: network,
    };
    if (apiKey !== undefined) setupOpts.forkApiKey = apiKey;
    const ctx = await setupLocalTesting(setupOpts);
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
   * @param _faucetUrl - Reserved for future auto-fund support on networks with a faucet.
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

  /**
   * Deploy a Move package as a code object via `movement move deploy-object`.
   *
   * The derived object address is bound to `options.moduleName` as a
   * named address at compile time, then captured into the returned
   * {@link CodeObjectInfo.address} for later use with
   * `harness.runtime.getContract(address, moduleName)`.
   *
   * Not available on fork-mode harnesses (forks are read-only). Calling
   * this on a `Harness.createFork(...)` instance throws synchronously.
   */
  async deployCodeObject(options: DeployCodeObjectOptions): Promise<CodeObjectInfo> {
    if (this.mode === "fork") {
      throw new Error(
        "Harness.createFork is read-only; code-object deployment requires Harness.createLocal or createLive."
      );
    }
    return deployCodeObject(this.runtime, options);
  }

  /**
   * Upgrade an existing code object via `movement move upgrade-object`.
   *
   * Requires {@link UpgradeCodeObjectOptions.objectAddress} (the existing
   * on-chain object). Overwrites the local deployment record's timestamp
   * + txHash; address stays the same.
   *
   * Not available on fork-mode harnesses (forks are read-only).
   */
  async upgradeCodeObject(
    options: UpgradeCodeObjectOptions
  ): Promise<CodeObjectInfo> {
    if (this.mode === "fork") {
      throw new Error(
        "Harness.createFork is read-only; code-object upgrade requires Harness.createLocal or createLive."
      );
    }
    return upgradeCodeObject(this.runtime, options);
  }

  /**
   * Execute a Move view function via the Aptos SDK.
   *
   * Returns the raw view-function result array. For single-value
   * returns, destructure: `const [count] = await harness.runViewFunction(...)`.
   *
   * Works on all 3 harness modes (createLocal, createFork, createLive)
   * — view functions are read-only.
   */
  async runViewFunction(options: RunViewFunctionOptions): Promise<unknown[]> {
    return runViewFunction(this.runtime, options);
  }

  /**
   * Execute a Move script via `movement move run-script`.
   *
   * Accepts either a `.move` source path (CLI auto-compiles) or a
   * pre-compiled `.mv` bytecode path. Other extensions throw
   * synchronously.
   *
   * Not available on fork-mode harnesses (forks are read-only).
   */
  async runMoveScript(options: RunMoveScriptOptions): Promise<MoveScriptResult> {
    if (this.mode === "fork") {
      throw new Error(
        "Harness.createFork is read-only; script execution requires Harness.createLocal or createLive."
      );
    }
    return runMoveScript(this.runtime, options);
  }
}
