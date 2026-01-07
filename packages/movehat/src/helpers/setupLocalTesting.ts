import { join } from "path";
import { existsSync } from "fs";
import { initRuntime } from "../runtime.js";
import type { MovehatRuntime } from "../types/runtime.js";
import { ForkManager } from "../fork/manager.js";
import { ForkServer } from "../fork/server.js";
import { AccountManager } from "../core/AccountManager.js";
import type { LocalTestOptions } from "../types/config.js";

let currentForkServer: ForkServer | null = null;
let currentForkManager: ForkManager | null = null;

/**
 * Setup a local testing environment with fork server and pre-funded accounts
 *
 * This function provides a complete local testing setup similar to Hardhat:
 * 1. Creates/loads a fork of testnet
 * 2. Starts a local fork server
 * 3. Generates labeled accounts (deployer, alice, bob, etc.)
 * 4. Pre-funds all accounts
 * 5. Returns a runtime configured to use the local fork
 *
 * @param options Configuration options for local testing
 * @returns MovehatRuntime configured for local testing
 *
 * @example
 * ```typescript
 * import { setupLocalTesting } from "movehat/helpers";
 *
 * describe("My Tests", () => {
 *   before(async function () {
 *     this.timeout(60000);
 *     mh = await setupLocalTesting({
 *       accountLabels: ['alice', 'bob', 'charlie'],
 *       defaultBalance: 200_000_000, // 200 APT
 *     });
 *   });
 *
 *   it("should have funded accounts", async () => {
 *     const alice = AccountManager.getAccountByLabel("alice");
 *     // alice is funded and ready to use
 *   });
 * });
 * ```
 */
export async function setupLocalTesting(
  options: LocalTestOptions = {}
): Promise<MovehatRuntime> {
  // Default options
  const forkNetwork = options.forkNetwork || "testnet";
  const forkName = options.forkName || "test-local";
  const autoFund = options.autoFund !== false; // default true
  const defaultBalance = options.defaultBalance || 100_000_000; // 100 APT
  const accountLabels = options.accountLabels || ["deployer", "alice", "bob"];
  const resetState = options.resetState !== false; // default true
  const port = options.port || 8080;

  console.log(`\n🔧 Setting up local testing environment...`);
  console.log(`   Fork network: ${forkNetwork}`);
  console.log(`   Fork name: ${forkName}`);
  console.log(`   Server port: ${port}\n`);

  // 1. Setup fork
  const forkPath = join(process.cwd(), ".movehat", "forks", forkName);
  const forkManager = new ForkManager(forkPath);
  currentForkManager = forkManager;

  const forkExists = existsSync(join(forkPath, "metadata.json"));

  if (!forkExists) {
    console.log(`📸 Creating fork from ${forkNetwork}...`);

    // Get testnet RPC URL
    const testnetRpc = "https://testnet.movementnetwork.xyz/v1";
    await forkManager.initialize(testnetRpc, forkNetwork);

    console.log(`✓ Fork created at ${forkPath}\n`);
  } else {
    console.log(`✓ Loading existing fork from ${forkPath}`);
    forkManager.load();

    if (resetState) {
      console.log(`🔄 Resetting fork state...`);
      await forkManager.resetState();
    }

    console.log();
  }

  // 2. Start fork server
  console.log(`🚀 Starting fork server on port ${port}...`);
  const forkServer = new ForkServer(forkPath, port);
  currentForkServer = forkServer;

  await forkServer.start();
  console.log(`✓ Fork server running at http://localhost:${port}\n`);

  // Give server a moment to fully start
  await new Promise((resolve) => setTimeout(resolve, 500));

  // 3. Generate accounts with AccountManager
  console.log(`👥 Generating ${accountLabels.length} test accounts...`);
  const accounts = AccountManager.createBatch(accountLabels);

  for (const [label, account] of Object.entries(accounts)) {
    console.log(`   ${label}: ${account.accountAddress.toString()}`);
  }
  console.log();

  // 4. Fund accounts
  if (autoFund) {
    const addresses = Object.values(accounts).map((acc) =>
      acc.accountAddress.toString()
    );
    await forkManager.fundMultipleAccounts(addresses, defaultBalance);
  }

  // 5. Initialize runtime pointing to local fork
  console.log(`⚙️  Initializing runtime for local network...`);

  // Get deployer private key from AccountManager
  const deployerPrivateKey = AccountManager.exportPrivateKeys(["deployer"]).deployer;

  if (!deployerPrivateKey) {
    throw new Error("Failed to get deployer private key");
  }

  // Create config override to point to local fork
  const runtime = await initRuntime({
    network: "local",
    configOverride: {
      networks: {
        local: {
          url: `http://localhost:${port}/v1`,
          chainId: "local",
        },
      },
      accounts: [deployerPrivateKey], // Use deployer as primary account
    },
  });

  console.log(`✓ Runtime initialized\n`);

  // 6. Auto-deploy modules if specified
  if (options.autoDeploy && options.autoDeploy.length > 0) {
    console.log(`📦 Auto-deploying ${options.autoDeploy.length} module(s)...`);

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

    console.log();
  }

  console.log(`✅ Local testing environment ready!\n`);
  console.log(`   RPC: http://localhost:${port}/v1`);
  console.log(`   Accounts: ${accountLabels.join(", ")}`);
  console.log(`   Balance per account: ${defaultBalance / 100_000_000} APT\n`);

  return runtime;
}

/**
 * Stop the fork server (cleanup)
 * Call this in your test suite's `after` hook
 *
 * @example
 * ```typescript
 * after(async () => {
 *   await stopLocalTesting();
 * });
 * ```
 */
export async function stopLocalTesting(): Promise<void> {
  if (currentForkServer) {
    console.log(`\n🛑 Stopping fork server...`);
    await currentForkServer.stop();
    currentForkServer = null;
    currentForkManager = null;
    console.log(`✓ Fork server stopped\n`);
  }
}

/**
 * Get the current fork manager (if local testing is active)
 *
 * @returns ForkManager instance or null
 */
export function getCurrentForkManager(): ForkManager | null {
  return currentForkManager;
}

/**
 * Reset fork state to initial snapshot
 * Useful for test isolation - call between tests
 *
 * @example
 * ```typescript
 * afterEach(async () => {
 *   await resetForkState();
 * });
 * ```
 */
export async function resetForkState(): Promise<void> {
  if (currentForkManager) {
    await currentForkManager.resetState();
  } else {
    console.warn("Warning: No active fork manager to reset");
  }
}
