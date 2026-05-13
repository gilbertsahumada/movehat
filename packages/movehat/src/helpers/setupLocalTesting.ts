import { join } from "path";
import { existsSync } from "fs";
import { initRuntime } from "../runtime.js";
import type { MovehatRuntime } from "../types/runtime.js";
import { ForkManager } from "../fork/manager.js";
import { ForkServer } from "../fork/server.js";
import { LocalNodeManager } from "../node/LocalNodeManager.js";
import { AccountManager } from "../core/AccountManager.js";
import { logger } from "../ui/index.js";
import type { LocalTestOptions } from "../types/config.js";

let currentForkServer: ForkServer | null = null;
let currentForkManager: ForkManager | null = null;
let currentLocalNode: LocalNodeManager | null = null;

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
 * @returns MovehatRuntime configured for local testing
 *
 * @example
 * ```typescript
 * // Local node mode (default) - Full blockchain, can deploy
 * const mh = await setupLocalTesting({
 *   mode: 'local-node',
 *   accountLabels: ['alice', 'bob'],
 *   autoDeploy: ['counter'],  // ✅ Works!
 * });
 *
 * // Fork mode - Fast, read-only
 * const mh = await setupLocalTesting({
 *   mode: 'fork',
 *   accountLabels: ['alice', 'bob'],
 *   autoDeploy: ['counter'],  // ❌ Won't work (fork can't deploy)
 * });
 * ```
 */
export async function setupLocalTesting(
  options: LocalTestOptions = {}
): Promise<MovehatRuntime> {
  // Default options
  const mode = options.mode || 'local-node';  // Default to local node
  const autoFund = options.autoFund !== false; // default true
  const defaultBalance = options.defaultBalance || 100_000_000; // 100 APT
  const accountLabels = options.accountLabels || ["deployer", "alice", "bob"];

  logger.newline();
  logger.step("Setting up local testing environment...");
  logger.plain(`   Mode: ${mode}`);
  logger.plain(`   Accounts: ${accountLabels.join(", ")}`);
  logger.newline();

  if (mode === 'local-node') {
    return await setupWithLocalNode(options, accountLabels, autoFund, defaultBalance);
  } else {
    return await setupWithFork(options, accountLabels, autoFund, defaultBalance);
  }
}

/**
 * Setup using local Movement node (full blockchain)
 */
async function setupWithLocalNode(
  options: LocalTestOptions,
  accountLabels: readonly string[],
  autoFund: boolean,
  defaultBalance: number
): Promise<MovehatRuntime> {
  const nodeTestDir = options.nodeTestDir || join(process.cwd(), ".movehat", "local-node");
  const nodeForceRestart = options.nodeForceRestart !== false; // default true
  const nodeFaucetPort = options.nodeFaucetPort || 8081;
  const nodeApiPort = options.nodeApiPort || 8080;
  const nodeReadyPort = options.nodeReadyPort || 8070;
  const nodeSilent = options.nodeSilent ?? false;

  // 1. Start local node
  const localNode = new LocalNodeManager({
    testDir: nodeTestDir,
    forceRestart: nodeForceRestart,
    faucetPort: nodeFaucetPort,
    apiPort: nodeApiPort,
    readyPort: nodeReadyPort,
    silent: nodeSilent,
  });

  currentLocalNode = localNode;

  const nodeInfo = await localNode.start();

  // 2. Generate accounts with AccountManager
  logger.step(`Generating ${accountLabels.length} test accounts...`);
  const accounts = AccountManager.createBatch(accountLabels);

  for (const [label, account] of Object.entries(accounts)) {
    logger.plain(`   ${label}: ${account.accountAddress.toString()}`);
  }
  logger.newline();

  // 3. Fund accounts from local faucet
  if (autoFund) {
    const accountsList = Object.values(accounts);
    await localNode.fundAccounts(accountsList, defaultBalance);
  }

  // 4. Initialize runtime pointing to local node
  logger.step("Initializing runtime for local network...");

  const deployerPrivateKey = AccountManager.exportPrivateKeys(["deployer"]).deployer;

  if (!deployerPrivateKey) {
    throw new Error("Failed to get deployer private key");
  }

  const runtime = await initRuntime({
    network: "local",
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

  // 5. Auto-deploy modules if specified
  if (options.autoDeploy && options.autoDeploy.length > 0) {
    logger.step(`Auto-deploying ${options.autoDeploy.length} module(s)...`);

    // Force redeploy in local-node mode (for testing)
    const previousRedeploy = process.env.MH_CLI_REDEPLOY;
    process.env.MH_CLI_REDEPLOY = 'true';

    try {
      for (const moduleName of options.autoDeploy) {
        try {
          logger.plain(`   Deploying ${moduleName}...`);
          await runtime.deployContract(moduleName);
          logger.success(`${moduleName} deployed`, 2);
        } catch (error: any) {
          logger.error(`Failed to deploy ${moduleName}: ${error.message}`, 2);
          throw error;
        }
      }
    } finally {
      // Restore previous value
      if (previousRedeploy === undefined) {
        delete process.env.MH_CLI_REDEPLOY;
      } else {
        process.env.MH_CLI_REDEPLOY = previousRedeploy;
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
  logger.plain(`   Balance per account: ${defaultBalance / 100_000_000} APT`);
  logger.newline();

  return runtime;
}

/**
 * Setup using fork server (read-only)
 */
async function setupWithFork(
  options: LocalTestOptions,
  accountLabels: readonly string[],
  autoFund: boolean,
  defaultBalance: number
): Promise<MovehatRuntime> {
  const forkNetwork = options.forkNetwork || "testnet";
  const forkName = options.forkName || "test-local";
  const forkPort = options.forkPort || 8080;
  const forkResetState = options.forkResetState !== false; // default true

  logger.plain(`   Fork network: ${forkNetwork}`);
  logger.plain(`   Fork name: ${forkName}`);
  logger.plain(`   Server port: ${forkPort}`);
  logger.newline();

  // Warn about auto-deploy in fork mode
  if (options.autoDeploy && options.autoDeploy.length > 0) {
    logger.warning("Auto-deploy doesn't work in fork mode (read-only).");
    logger.plain("   Switch to 'local-node' mode for deployment support.");
    logger.newline();
  }

  // 1. Setup fork
  const forkPath = join(process.cwd(), ".movehat", "forks", forkName);
  const forkManager = new ForkManager(forkPath);
  currentForkManager = forkManager;

  const forkExists = existsSync(join(forkPath, "metadata.json"));

  if (!forkExists) {
    logger.step(`Creating fork from ${forkNetwork}...`);
    const testnetRpc = "https://testnet.movementnetwork.xyz/v1";
    await forkManager.initialize(testnetRpc, forkNetwork);
    logger.success(`Fork created at ${forkPath}`);
    logger.newline();
  } else {
    logger.success(`Loading existing fork from ${forkPath}`);
    forkManager.load();

    if (forkResetState) {
      logger.step("Resetting fork state...");
      await forkManager.resetState();
    }

    logger.newline();
  }

  // 2. Start fork server
  logger.step(`Starting fork server on port ${forkPort}...`);
  const forkServer = new ForkServer(forkPath, forkPort);
  currentForkServer = forkServer;

  await forkServer.start();
  logger.success(`Fork server running at http://localhost:${forkPort}`);
  logger.newline();

  await new Promise((resolve) => setTimeout(resolve, 500));

  // 3. Generate accounts
  logger.step(`Generating ${accountLabels.length} test accounts...`);
  const accounts = AccountManager.createBatch(accountLabels);

  for (const [label, account] of Object.entries(accounts)) {
    logger.plain(`   ${label}: ${account.accountAddress.toString()}`);
  }
  logger.newline();

  // 4. Fund accounts in fork
  if (autoFund) {
    const addresses = Object.values(accounts).map((acc) =>
      acc.accountAddress.toString()
    );
    await forkManager.fundMultipleAccounts(addresses, defaultBalance);
  }

  // 5. Initialize runtime pointing to fork
  logger.step("Initializing runtime for local network...");

  const deployerPrivateKey = AccountManager.exportPrivateKeys(["deployer"]).deployer;

  if (!deployerPrivateKey) {
    throw new Error("Failed to get deployer private key");
  }

  const runtime = await initRuntime({
    network: "local",
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
  logger.plain(`   Balance per account: ${defaultBalance / 100_000_000} APT`);
  logger.newline();

  return runtime;
}

/**
 * Stop the local testing environment (cleanup)
 */
export async function stopLocalTesting(): Promise<void> {
  logger.newline();
  logger.step("Stopping local testing environment...");

  // Stop local node if running
  if (currentLocalNode) {
    await currentLocalNode.stop();
    currentLocalNode = null;
  }

  // Stop fork server if running
  if (currentForkServer) {
    await currentForkServer.stop();
    currentForkServer = null;
    currentForkManager = null;
  }

  logger.success("Environment stopped");
  logger.newline();
}

/**
 * Get the current fork manager (if fork mode is active)
 */
export function getCurrentForkManager(): ForkManager | null {
  return currentForkManager;
}

/**
 * Get the current local node (if local node mode is active)
 */
export function getCurrentLocalNode(): LocalNodeManager | null {
  return currentLocalNode;
}

/**
 * Reset fork state to initial snapshot (fork mode only)
 */
export async function resetForkState(): Promise<void> {
  if (currentForkManager) {
    await currentForkManager.resetState();
  } else {
    console.warn("Warning: No active fork manager to reset");
  }
}
