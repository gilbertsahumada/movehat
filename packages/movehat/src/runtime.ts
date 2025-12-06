import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import { MovehatRuntime, NetworkInfo } from "./types/runtime.js";
import { MovehatConfig, MovehatUserConfig } from "./types/config.js";
import { loadUserConfig, resolveNetworkConfig } from "./helpers/config.js";
import { getContract, MoveContract } from "./helpers/contract.js";
import {
  saveDeployment,
  loadDeployment,
  getAllDeployments,
  getDeployedAddress,
  DeploymentInfo,
} from "./helpers/deployments.js";

let cachedRuntime: MovehatRuntime | null = null;

export interface InitRuntimeOptions {
  network?: string;
  accountIndex?: number;
  configOverride?: Partial<MovehatUserConfig>;
}

/**
 * Initialize the Movehat Runtime Environment
 * This function loads the configuration and creates the runtime context
 */
export async function initRuntime(
  options: InitRuntimeOptions = {}
): Promise<MovehatRuntime> {
  // Load user config from movehat.config.ts
  const userConfig = await loadUserConfig();

  // Apply config override if provided
  const mergedUserConfig: MovehatUserConfig = options.configOverride
    ? { ...userConfig, ...options.configOverride }
    : userConfig;

  // Resolve configuration for selected network
  const config = await resolveNetworkConfig(mergedUserConfig, options.network);

  // Setup Aptos client
  const aptosConfig = new AptosConfig({
    network: config.network as Network,
    fullnode: config.rpc,
  });
  const aptos = new Aptos(aptosConfig);

  // Setup accounts
  const accountIndex = options.accountIndex || 0;
  const accounts: Account[] = config.allAccounts.map((pk) => {
    const privateKey = new Ed25519PrivateKey(pk);
    return Account.fromPrivateKey({ privateKey });
  });

  // Primary account (accounts[0] or selected index)
  const account = accounts[accountIndex];
  if (!account) {
    throw new Error(`Account index ${accountIndex} not found. Only ${accounts.length} accounts configured.`);
  }

  // Update config.account with derived address
  config.account = account.accountAddress.toString();

  // Network info
  const network: NetworkInfo = {
    name: config.network,
    rpc: config.rpc,
  };

  // Helper functions
  const getContractHelper = (address: string, moduleName: string): MoveContract => {
    return getContract(aptos, address, moduleName);
  };

  const deployContract = async (
    moduleName: string,
    options?: {
      packageDir?: string;
    }
  ): Promise<DeploymentInfo> => {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const { existsSync, mkdirSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const execAsync = promisify(exec);

    // Check if --redeploy flag was passed via CLI
    const forceRedeploy = process.env.MH_CLI_REDEPLOY === 'true';

    // Check if already deployed
    const existingDeployment = loadDeployment(config.network, moduleName);
    if (existingDeployment && !forceRedeploy) {
      console.error(`\n❌ Module "${moduleName}" is already deployed on ${config.network}`);
      console.error(`   Address: ${existingDeployment.address}`);
      console.error(`   Deployed at: ${new Date(existingDeployment.timestamp).toLocaleString()}`);
      if (existingDeployment.txHash) {
        console.error(`   Transaction: ${existingDeployment.txHash}`);
      }
      console.error(`\n💡 To redeploy, run with the --redeploy flag:`);
      console.error(`   movehat run <script> --network ${config.network} --redeploy\n`);
      process.exit(1);
    }

    if (forceRedeploy && existingDeployment) {
      console.log(`🔄 Redeploying module "${moduleName}" on ${config.network}...`);
    }

    const dir = options?.packageDir || config.moveDir;
    const profile = config.profile || "default";

    console.log(`📦 Publishing module "${moduleName}" from ${dir}...`);

    try {
      // Ensure Movement CLI config exists
      const aptosConfigDir = join(homedir(), ".aptos");
      const aptosConfigPath = join(aptosConfigDir, "config.yaml");

      if (!existsSync(aptosConfigPath)) {
        console.log("⚙️  Creating Movement CLI configuration...");
        if (!existsSync(aptosConfigDir)) {
          mkdirSync(aptosConfigDir, { recursive: true });
        }

        // Create minimal config.yaml
        const configContent = `---
profiles:
  ${profile}:
    private_key: "${config.privateKey}"
    public_key: "${account.publicKey.toString()}"
    account: ${account.accountAddress.toString()}
    rest_url: "${config.rpc}"
`;
        writeFileSync(aptosConfigPath, configContent, "utf-8");
      }

      // Build first
      console.log("🔨 Building package...");
      const buildCmd = `movement move build --package-dir ${dir}`;
      const { stdout: buildOut } = await execAsync(buildCmd);
      if (buildOut) console.log(buildOut.trim());

      // Publish
      console.log("📤 Publishing to blockchain...");
      const publishCmd = `movement move publish --profile ${profile} --package-dir ${dir} --assume-yes`;
      const { stdout: publishOut } = await execAsync(publishCmd);
      if (publishOut) console.log(publishOut.trim());

      // Extract transaction hash from output
      let txHash: string | undefined;
      const txHashMatch = publishOut.match(/0x[a-fA-F0-9]{64}/);
      if (txHashMatch) {
        txHash = txHashMatch[0];
      }

      console.log(`✅ Module published successfully!`);

      // Create deployment info
      const deployment: DeploymentInfo = {
        address: account.accountAddress.toString(),
        moduleName,
        network: config.network,
        deployer: account.accountAddress.toString(),
        timestamp: Date.now(),
        txHash,
      };

      // Save deployment
      saveDeployment(deployment);

      return deployment;
    } catch (error: any) {
      console.error(`❌ Failed to publish module: ${error.message}`);
      throw error;
    }
  };

  const getDeployment = (moduleName: string): DeploymentInfo | null => {
    return loadDeployment(config.network, moduleName);
  };

  const getDeployments = (): Record<string, DeploymentInfo> => {
    return getAllDeployments(config.network);
  };

  const getDeploymentAddress = (moduleName: string): string | null => {
    return getDeployedAddress(config.network, moduleName);
  };

  const createAccount = (): Account => {
    return Account.generate();
  };

  const getAccountHelper = (privateKeyHex: string): Account => {
    const pk = new Ed25519PrivateKey(privateKeyHex);
    return Account.fromPrivateKey({ privateKey: pk });
  };

  const getAccountByIndex = (index: number): Account => {
    if (index < 0 || index >= accounts.length) {
      throw new Error(`Account index ${index} out of range. Available accounts: 0-${accounts.length - 1}`);
    }
    return accounts[index];
  };

  const switchNetwork = async (networkName: string): Promise<void> => {
    // Clear cache and reinitialize with new network
    cachedRuntime = null;
    await initRuntime({ ...options, network: networkName });
  };

  // Build runtime object
  const runtime: MovehatRuntime = {
    config,
    network,
    aptos,
    account,
    accounts,
    getContract: getContractHelper,
    deployContract,
    getDeployment,
    getDeployments,
    getDeploymentAddress,
    createAccount,
    getAccount: getAccountHelper,
    getAccountByIndex,
    switchNetwork,
  };

  cachedRuntime = runtime;
  return runtime;
}

/**
 * Get the current Movehat Runtime Environment
 * Throws error if runtime hasn't been initialized
 */
export function getRuntime(): MovehatRuntime {
  if (!cachedRuntime) {
    throw new Error(
      "Movehat Runtime not initialized. Call initRuntime() first or use getMovehat()."
    );
  }
  return cachedRuntime;
}

/**
 * Get or initialize the Movehat Runtime Environment
 * This is a convenience function that initializes if needed
 */
export async function getMovehat(): Promise<MovehatRuntime> {
  if (cachedRuntime) {
    return cachedRuntime;
  }
  return initRuntime();
}

// Export a default instance getter for convenience
export const mh = {
  get runtime() {
    return getRuntime();
  },
};
