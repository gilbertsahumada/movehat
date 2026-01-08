import { join } from "path";
import { existsSync } from "fs";
import { initRuntime } from "../runtime.js";
import type { MovehatRuntime } from "../types/runtime.js";
import { ForkManager } from "../fork/manager.js";
import { ForkServer } from "../fork/server.js";
import { LocalNodeManager } from "../node/LocalNodeManager.js";
import { AccountManager } from "../core/AccountManager.js";
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

  console.log(`\n🔧 Setting up local testing environment...`);
  console.log(`   Mode: ${mode}`);
  console.log(`   Accounts: ${accountLabels.join(", ")}\n`);

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
  console.log(`👥 Generating ${accountLabels.length} test accounts...`);
  const accounts = AccountManager.createBatch(accountLabels);

  for (const [label, account] of Object.entries(accounts)) {
    console.log(`   ${label}: ${account.accountAddress.toString()}`);
  }
  console.log();

  // 3. Fund accounts from local faucet
  if (autoFund) {
    const accountsList = Object.values(accounts);
    await localNode.fundAccounts(accountsList, defaultBalance);
  }

  // 4. Initialize runtime pointing to local node
  console.log(`⚙️  Initializing runtime for local network...`);

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

  console.log(`✓ Runtime initialized\n`);

  // 5. Auto-deploy modules if specified
  if (options.autoDeploy && options.autoDeploy.length > 0) {
    console.log(`📦 Auto-deploying ${options.autoDeploy.length} module(s)...`);

    // Force redeploy in local-node mode (for testing)
    const previousRedeploy = process.env.MH_CLI_REDEPLOY;
    process.env.MH_CLI_REDEPLOY = 'true';

    try {
      for (const moduleName of options.autoDeploy) {
        try {
          console.log(`   Deploying ${moduleName}...`);
          await runtime.deployContract(moduleName);
          console.log(`   ✓ ${moduleName} deployed`);
        } catch (error: any) {
          console.error(`   ✗ Failed to deploy ${moduleName}: ${error.message}`);
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

    console.log();
  }

  console.log(`✅ Local testing environment ready!\n`);
  console.log(`   Mode: local-node`);
  console.log(`   RPC: ${nodeInfo.rpcUrl}/v1`);
  console.log(`   Faucet: ${nodeInfo.faucetUrl}`);
  console.log(`   Accounts: ${Array.from(accountLabels).join(", ")}`);
  console.log(`   Balance per account: ${defaultBalance / 100_000_000} APT\n`);

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

  console.log(`   Fork network: ${forkNetwork}`);
  console.log(`   Fork name: ${forkName}`);
  console.log(`   Server port: ${forkPort}\n`);

  // Warn about auto-deploy in fork mode
  if (options.autoDeploy && options.autoDeploy.length > 0) {
    console.warn(`⚠️  WARNING: Auto-deploy doesn't work in fork mode (read-only).`);
    console.warn(`   Switch to 'local-node' mode for deployment support.\n`);
  }

  // 1. Setup fork
  const forkPath = join(process.cwd(), ".movehat", "forks", forkName);
  const forkManager = new ForkManager(forkPath);
  currentForkManager = forkManager;

  const forkExists = existsSync(join(forkPath, "metadata.json"));

  if (!forkExists) {
    console.log(`📸 Creating fork from ${forkNetwork}...`);
    const testnetRpc = "https://testnet.movementnetwork.xyz/v1";
    await forkManager.initialize(testnetRpc, forkNetwork);
    console.log(`✓ Fork created at ${forkPath}\n`);
  } else {
    console.log(`✓ Loading existing fork from ${forkPath}`);
    forkManager.load();

    if (forkResetState) {
      console.log(`🔄 Resetting fork state...`);
      await forkManager.resetState();
    }

    console.log();
  }

  // 2. Start fork server
  console.log(`🚀 Starting fork server on port ${forkPort}...`);
  const forkServer = new ForkServer(forkPath, forkPort);
  currentForkServer = forkServer;

  await forkServer.start();
  console.log(`✓ Fork server running at http://localhost:${forkPort}\n`);

  await new Promise((resolve) => setTimeout(resolve, 500));

  // 3. Generate accounts
  console.log(`👥 Generating ${accountLabels.length} test accounts...`);
  const accounts = AccountManager.createBatch(accountLabels);

  for (const [label, account] of Object.entries(accounts)) {
    console.log(`   ${label}: ${account.accountAddress.toString()}`);
  }
  console.log();

  // 4. Fund accounts in fork
  if (autoFund) {
    const addresses = Object.values(accounts).map((acc) =>
      acc.accountAddress.toString()
    );
    await forkManager.fundMultipleAccounts(addresses, defaultBalance);
  }

  // 5. Initialize runtime pointing to fork
  console.log(`⚙️  Initializing runtime for local network...`);

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

  console.log(`✓ Runtime initialized\n`);
  console.log(`✅ Local testing environment ready!\n`);
  console.log(`   Mode: fork (read-only)`);
  console.log(`   RPC: http://localhost:${forkPort}/v1`);
  console.log(`   Accounts: ${Array.from(accountLabels).join(", ")}`);
  console.log(`   Balance per account: ${defaultBalance / 100_000_000} APT\n`);

  return runtime;
}

/**
 * Stop the local testing environment (cleanup)
 */
export async function stopLocalTesting(): Promise<void> {
  console.log(`\n🛑 Stopping local testing environment...`);

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

  console.log(`✓ Environment stopped\n`);
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
