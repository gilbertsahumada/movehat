import { join } from "path";
import { existsSync } from "fs";
import { initRuntime } from "../runtime.js";
import type { MovehatRuntime } from "../types/runtime.js";
import { ForkManager } from "../fork/manager.js";
import { ForkServer } from "../fork/server.js";
import { LocalNodeManager } from "../node/LocalNodeManager.js";
import type { LocalNodeInfo } from "../node/LocalNodeManager.js";
import { MoveliteManager, findMoveliteBinary } from "../node/MoveliteManager.js";
import type { NodeProvider } from "../node/NodeProvider.js";
import { AccountManager } from "../core/AccountManager.js";
import { acquireSharedMoveliteNode } from "./sharedMoveliteNode.js";
import { logger } from "../ui/index.js";
import type { LocalTestOptions } from "../types/config.js";

const BUILTIN_FORK_RPCS: Record<string, string> = {
  testnet: "https://testnet.movementnetwork.xyz/v1",
  mainnet: "https://mainnet.movementnetwork.xyz/v1",
};

function resolveForkRpcUrl(
  network: string,
  override: string | undefined
): string {
  if (override !== undefined) return override;
  const builtin = BUILTIN_FORK_RPCS[network];
  if (builtin !== undefined) return builtin;
  throw new Error(
    `Cannot fork unknown network "${network}" without a forkRpcUrl. ` +
      `Either pass forkRpcUrl in LocalTestOptions or use one of: ` +
      `${Object.keys(BUILTIN_FORK_RPCS).join(", ")}.`
  );
}

/**
 * Context returned by {@link setupLocalTesting}.
 *
 * Each invocation gets its own runtime and accounts. The local node may be
 * shared: when movelite is the auto-selected backend, every context in the
 * process reuses one node (`ownsNode` is false and `teardown` leaves it
 * running; it is killed automatically at process exit).
 *
 * @public The `runtime`, `ownsNode`, and `teardown` fields are the
 *         supported surface. `localNode`, `forkServer`, and `forkManager`
 *         are exposed for escape hatches (e.g. mid-test
 *         `forkManager.resetState()`) but their concrete shapes are
 *         `@internal`.
 */
export interface LocalTestingContext {
  runtime: MovehatRuntime;
  /** @internal */
  localNode?: NodeProvider;
  /** @internal */
  forkServer?: ForkServer;
  /** @internal */
  forkManager?: ForkManager;
  /**
   * Whether this context owns its local node. False when the node is the
   * process-shared movelite instance or was injected via
   * `options.localNode` — `teardown()` then leaves the node running.
   * Fork-mode contexts always report true (they own their fork server).
   */
  ownsNode: boolean;
  /** Stop the local node and/or fork server owned by this context. */
  teardown: () => Promise<void>;
}

/**
 * Setup a local testing environment with either a local node or fork server
 *
 * This function provides a complete local testing setup similar to Hardhat:
 *
 * **Local Node Mode** (default, recommended):
 * 1. Starts a full Movement node locally
 * 2. Generates and funds test accounts from local faucet
 * 3. Auto-deploys modules (works because node can process transactions)
 * 4. Returns runtime ready to use
 *
 * **Fork Mode** (faster, read-only):
 * 1. Creates/loads a fork of testnet
 * 2. Starts a fork server
 * 3. Generates and funds accounts (in fork state only)
 * 4. Cannot auto-deploy (fork is read-only)
 * 5. Returns runtime for reading data
 *
 * @param options Configuration options for local testing
 * @returns LocalTestingContext with runtime and a teardown closure
 *
 * @example
 * ```typescript
 * // Local node mode (default) - Full blockchain, can deploy
 * const ctx = await setupLocalTesting({
 *   mode: 'local-node',
 *   accountLabels: ['alice', 'bob'],
 *   autoDeploy: ['counter'],  // works
 * });
 * // ...use ctx.runtime...
 * await ctx.teardown();
 * ```
 */
export async function setupLocalTesting(
  options: LocalTestOptions = {}
): Promise<LocalTestingContext> {
  const mode = options.mode || 'local-node';
  const autoFund = options.autoFund !== false;
  const defaultBalance = options.defaultBalance || 100_000_000;
  const accountLabels = options.accountLabels || ["deployer", "alice", "bob"];

  logger.newline();
  logger.phase("Setting up local testing environment");
  logger.kv("Mode", mode, 2);
  logger.kv("Accounts", accountLabels.join(", "), 2);
  logger.newline();

  if (mode === 'local-node') {
    const { runtime, localNode, ownsNode } = await setupWithLocalNode(
      options, accountLabels, autoFund, defaultBalance
    );
    return {
      runtime,
      localNode,
      ownsNode,
      teardown: async () => {
        if (!ownsNode) return;
        logger.newline();
        logger.step("Stopping local testing environment...");
        await localNode.stop();
        logger.success("Environment stopped");
        logger.newline();
      },
    };
  } else {
    const { runtime, forkServer, forkManager } = await setupWithFork(
      options, accountLabels, autoFund, defaultBalance
    );
    return {
      runtime,
      forkServer,
      forkManager,
      ownsNode: true,
      teardown: async () => {
        logger.newline();
        logger.step("Stopping local testing environment...");
        await forkServer.stop();
        logger.success("Environment stopped");
        logger.newline();
      },
    };
  }
}

/**
 * Resolve whether to prefer movelite. Explicit `useMovelite` wins; otherwise
 * the `MOVEHAT_USE_MOVELITE` env var acts as an override (`0` disables, `1`
 * enables); default is enabled. Lets tooling force a backend without editing
 * test code.
 */
function resolveUseMovelite(useMovelite: boolean | undefined): boolean {
  if (useMovelite !== undefined) return useMovelite;
  return process.env.MOVEHAT_USE_MOVELITE !== "0";
}

/**
 * Any explicit node* option opts the caller out of the shared node and
 * into a private per-fixture spawn. The options themselves configure the
 * full Movement node only — movelite does not consume them — but they
 * still signal "this fixture wants its own node".
 */
function hasExplicitNodeOptions(options: LocalTestOptions): boolean {
  return (
    options.nodeTestDir !== undefined ||
    options.nodeForceRestart !== undefined ||
    options.nodeFaucetPort !== undefined ||
    options.nodeApiPort !== undefined ||
    options.nodeReadyPort !== undefined ||
    options.nodeSilent !== undefined
  );
}

/**
 * Setup using local Movement node (full blockchain)
 */
async function setupWithLocalNode(
  options: LocalTestOptions,
  accountLabels: readonly string[],
  autoFund: boolean,
  defaultBalance: number
): Promise<{ runtime: MovehatRuntime; localNode: NodeProvider; ownsNode: boolean }> {
  let localNode: NodeProvider;
  let ownsNode: boolean;
  let nodeInfo: LocalNodeInfo;

  if (options.localNode) {
    localNode = options.localNode;
    ownsNode = false;
    if (!localNode.isRunning()) {
      throw new Error(
        "localNode was provided but isRunning() is false. " +
        "Start the node before passing it to setupLocalTesting."
      );
    }
    nodeInfo = localNode.getNodeInfo();
  } else if (resolveUseMovelite(options.useMovelite) && findMoveliteBinary()) {
    const binary = findMoveliteBinary()!;
    if (hasExplicitNodeOptions(options)) {
      localNode = new MoveliteManager(binary);
      nodeInfo = await localNode.start();
      ownsNode = true;
    } else {
      // Implicit sharing: the first fixture in the process boots one
      // movelite node, later fixtures reuse it. Nothing stops it — once
      // ready it is unref'd and the process-exit hooks kill it.
      const acquired = await acquireSharedMoveliteNode(
        () => new MoveliteManager(binary)
      );
      localNode = acquired.node;
      nodeInfo = acquired.nodeInfo;
      ownsNode = false;
    }
  } else {
    const nodeTestDir = options.nodeTestDir || join(process.cwd(), ".movehat", "local-node");
    const nodeForceRestart = options.nodeForceRestart !== false;
    const nodeFaucetPort = options.nodeFaucetPort || 8081;
    const nodeApiPort = options.nodeApiPort || 8080;
    const nodeReadyPort = options.nodeReadyPort || 8070;
    const nodeSilent = options.nodeSilent ?? false;

    localNode = new LocalNodeManager({
      testDir: nodeTestDir,
      forceRestart: nodeForceRestart,
      faucetPort: nodeFaucetPort,
      apiPort: nodeApiPort,
      readyPort: nodeReadyPort,
      silent: nodeSilent,
    });
    ownsNode = true;
    nodeInfo = await localNode.start();
  }

  // Once the node is up, every later step (account creation, funding,
  // runtime init, autoDeploy) is fallible. If any of them throws we
  // must stop the node we just started — otherwise the child process
  // leaks and port 8080 stays bound until the OS reaps it (manifests as
  // "Movement command failed" on the next test:example run).
  try {
    // Per-context AccountManager. Threaded into initRuntime below so
    // the runtime exposes the SAME instance — the labels created by
    // createBatch here are visible on `runtime.accountManager`.
    const accountManager = new AccountManager();

    logger.step(`Generating ${accountLabels.length} test accounts...`);
    const accounts = accountManager.createBatch(accountLabels);

    for (const [label, account] of Object.entries(accounts)) {
      logger.plain(`   ${label}: ${account.accountAddress.toString()}`);
    }
    logger.newline();

    if (autoFund) {
      const accountsList = Object.values(accounts);
      await localNode.fundAccounts(accountsList, defaultBalance);
    }

    logger.step("Initializing runtime for local network...");

    const deployerPrivateKey = accountManager.exportPrivateKeys(["deployer"]).deployer;

    if (!deployerPrivateKey) {
      throw new Error("Failed to get deployer private key");
    }

    // movelite exposes the /transactions/trace endpoint that powers
    // Foundry-style execution traces; a real Movement node does not. Compute
    // this once and reuse it for both the trace wiring and SDK publish below.
    const isMovelite = localNode instanceof MoveliteManager;

    const runtime = await initRuntime({
      network: "local",
      accountManager,
      ...(isMovelite ? { traceRpcUrl: `${nodeInfo.rpcUrl}/v1` } : {}),
      configOverride: {
        networks: {
          local: {
            url: `${nodeInfo.rpcUrl}/v1`,
            chainId: "local",
          },
        },
        accounts: [deployerPrivateKey],
      },
    });

    logger.success("Runtime initialized");
    logger.newline();

    if (options.autoDeploy && options.autoDeploy.length > 0) {
      logger.step(`Auto-deploying ${options.autoDeploy.length} module(s)...`);

      // movelite's REST responses can't drive the Movement CLI publish flow,
      // so deploy through the TypeScript SDK when it is the spawned backend.
      const sdkPublish = isMovelite;

      for (const moduleName of options.autoDeploy) {
        try {
          logger.plain(`   Deploying ${moduleName}...`);
          await runtime.deployContract(moduleName, { sdkPublish, redeploy: true });
          logger.success(`${moduleName} deployed`, 2);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error(`Failed to deploy ${moduleName}: ${msg}`, 2);
          throw error;
        }
      }

      logger.newline();
    }

    logger.success("Local testing environment ready!");
    logger.newline();
    logger.plain(`   Mode: local-node`);
    logger.plain(`   RPC: ${nodeInfo.rpcUrl}/v1`);
    logger.plain(`   Faucet: ${nodeInfo.faucetUrl}`);
    logger.plain(`   Accounts: ${Array.from(accountLabels).join(", ")}`);
    logger.plain(`   Balance per account: ${defaultBalance / 100_000_000} MOVE`);
    logger.newline();

    return { runtime, localNode, ownsNode };
  } catch (error) {
    if (ownsNode) {
      await localNode.stop().catch(() => {});
    }
    throw error;
  }
}

/**
 * Setup using fork server (read-only)
 */
async function setupWithFork(
  options: LocalTestOptions,
  accountLabels: readonly string[],
  autoFund: boolean,
  defaultBalance: number
): Promise<{ runtime: MovehatRuntime; forkServer: ForkServer; forkManager: ForkManager }> {
  const forkNetwork = options.forkNetwork || "testnet";
  const forkName = options.forkName || "test-local";
  const forkPort = options.forkPort || 8080;
  const forkResetState = options.forkResetState !== false;

  logger.plain(`   Fork network: ${forkNetwork}`);
  logger.plain(`   Fork name: ${forkName}`);
  logger.plain(`   Server port: ${forkPort}`);
  logger.newline();

  if (options.autoDeploy && options.autoDeploy.length > 0) {
    logger.warning("Auto-deploy doesn't work in fork mode (read-only).");
    logger.plain("   Switch to 'local-node' mode for deployment support.");
    logger.newline();
  }

  const forkPath = join(process.cwd(), ".movehat", "forks", forkName);
  const forkManager = new ForkManager(forkPath);

  const forkExists = existsSync(join(forkPath, "metadata.json"));

  if (!forkExists) {
    logger.step(`Creating fork from ${forkNetwork}...`);
    const rpcUrl = resolveForkRpcUrl(forkNetwork, options.forkRpcUrl);
    await forkManager.initialize(rpcUrl, forkNetwork, options.forkApiKey);
    logger.success(`Fork created at ${forkPath}`);
    logger.newline();
  } else {
    logger.success(`Loading existing fork from ${forkPath}`);
    // setApiKey BEFORE load() so the reconstructed MovementApiClient
    // picks up the header. load() rebuilds the client using current
    // apiKey state.
    if (options.forkApiKey !== undefined) {
      forkManager.setApiKey(options.forkApiKey);
    }
    forkManager.load();

    // Guard against the audit-f1 follow-up case: the default forkName
    // ("test-local") doesn't encode the network, so a fork created for
    // testnet would silently serve mainnet requests. Refuse to load
    // when the saved metadata's network doesn't match what the caller
    // asked for — the user must either pass a network-specific
    // `forkName` or delete the stale directory.
    const savedNetwork = forkManager.getMetadata().network;
    if (savedNetwork !== forkNetwork) {
      throw new Error(
        `Fork at ${forkPath} was created for network "${savedNetwork}" but ` +
          `you requested "${forkNetwork}". Use a different forkName ` +
          `(e.g. "${forkNetwork}-local") or delete ${forkPath} to recreate.`
      );
    }

    if (forkResetState) {
      logger.step("Resetting fork state...");
      await forkManager.resetState();
    }

    logger.newline();
  }

  logger.step(`Starting fork server on port ${forkPort}...`);
  const forkServer = new ForkServer(forkPath, forkPort);

  await forkServer.start();
  logger.success(`Fork server running at http://localhost:${forkPort}`);
  logger.newline();

  // Same cleanup-on-failure pattern as setupWithLocalNode: once the
  // fork server is listening, any later throw must stop the server or
  // we leak the listener.
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Per-context AccountManager (mirror of setupWithLocalNode pattern).
    const accountManager = new AccountManager();

    logger.step(`Generating ${accountLabels.length} test accounts...`);
    const accounts = accountManager.createBatch(accountLabels);

    for (const [label, account] of Object.entries(accounts)) {
      logger.plain(`   ${label}: ${account.accountAddress.toString()}`);
    }
    logger.newline();

    if (autoFund) {
      const addresses = Object.values(accounts).map((acc) =>
        acc.accountAddress.toString()
      );
      await forkManager.fundMultipleAccounts(addresses, defaultBalance);
    }

    logger.step("Initializing runtime for local network...");

    const deployerPrivateKey = accountManager.exportPrivateKeys(["deployer"]).deployer;

    if (!deployerPrivateKey) {
      throw new Error("Failed to get deployer private key");
    }

    const runtime = await initRuntime({
      network: "local",
      accountManager,
      configOverride: {
        networks: {
          local: {
            url: `http://localhost:${forkPort}/v1`,
            chainId: "local",
          },
        },
        accounts: [deployerPrivateKey],
      },
    });

    logger.success("Runtime initialized");
    logger.newline();
    logger.success("Local testing environment ready!");
    logger.newline();
    logger.plain(`   Mode: fork (read-only)`);
    logger.plain(`   RPC: http://localhost:${forkPort}/v1`);
    logger.plain(`   Accounts: ${Array.from(accountLabels).join(", ")}`);
    logger.plain(`   Balance per account: ${defaultBalance / 100_000_000} MOVE`);
    logger.newline();

    return { runtime, forkServer, forkManager };
  } catch (error) {
    await forkServer.stop().catch(() => {});
    throw error;
  }
}
