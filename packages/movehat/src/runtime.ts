import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import { MovehatRuntime, NetworkInfo } from "./types/runtime.js";
import { MovehatUserConfig } from "./types/config.js";
import { loadUserConfig, resolveNetworkConfig } from "./core/config.js";
import { getContract, MoveContract } from "./core/contract.js";
import {
  saveDeployment,
  loadDeployment,
  getAllDeployments,
  getDeployedAddress,
  DeploymentInfo,
  validateSafeName,
} from "./core/deployments.js";
import { CliExecutionError, ModuleAlreadyDeployedError } from "./errors.js";
import { AccountManager } from "./core/AccountManager.js";
import { runCli } from "./utils/runCli.js";
import type { ChildProcessAdapter } from "./utils/childProcessAdapter.js";

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
  // Movement Network uses custom chain IDs, so we need to use Network.CUSTOM
  // and let the SDK fetch the actual chainId from the node
  const aptosConfig = new AptosConfig({
    network: Network.CUSTOM,
    fullnode: config.rpc,
  });
  const aptos = new Aptos(aptosConfig);

  // Setup accounts using AccountManager
  const accountIndex = options.accountIndex || 0;
  const accounts: Account[] = AccountManager.loadAccountsFromConfig(config);

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
      adapter?: ChildProcessAdapter;
    }
  ): Promise<DeploymentInfo> => {
    // Validate moduleName early
    validateSafeName(moduleName, "module");

    const { existsSync, mkdirSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const yaml = await import("js-yaml");
    const { validatePathSafety, validateProfileSafety } = await import("./core/shell.js");

    // Check if --redeploy flag was passed via CLI
    const forceRedeploy = process.env.MH_CLI_REDEPLOY === 'true';

    // Check if already deployed
    const existingDeployment = loadDeployment(config.network, moduleName);
    if (existingDeployment && !forceRedeploy) {
      // Build detailed error message with all deployment info
      const errorDetails = [
        `Module "${moduleName}" is already deployed on ${config.network}`,
        `Address: ${existingDeployment.address}`,
        `Deployed at: ${new Date(existingDeployment.timestamp).toLocaleString()}`,
        existingDeployment.txHash ? `Transaction: ${existingDeployment.txHash}` : null,
        `\nTo redeploy, run with the --redeploy flag:`,
        `movehat run <script> --network ${config.network} --redeploy`,
      ].filter(Boolean).join('\n');

      // Log formatted error message for user
      const formattedMessage = [
        `\n❌ Module "${moduleName}" is already deployed on ${config.network}`,
        `   Address: ${existingDeployment.address}`,
        `   Deployed at: ${new Date(existingDeployment.timestamp).toLocaleString()}`,
        existingDeployment.txHash ? `   Transaction: ${existingDeployment.txHash}` : null,
        `\n💡 To redeploy, run with the --redeploy flag:`,
        `   movehat run <script> --network ${config.network} --redeploy\n`,
      ].filter(Boolean).join('\n');

      console.error(formattedMessage);

      // Throw custom error with complete context for programmatic handling
      throw new ModuleAlreadyDeployedError(
        errorDetails,
        moduleName,
        config.network,
        existingDeployment.address,
        existingDeployment.timestamp,
        existingDeployment.txHash
      );
    }

    if (forceRedeploy && existingDeployment) {
      console.log(`🔄 Redeploying module "${moduleName}" on ${config.network}...`);
    }

    const dir = options?.packageDir || config.moveDir;
    const profile = config.profile || "default";

    // Validate (no shell escape — runCli uses spawn, which takes args
    // verbatim and would treat the single-quote wrapping as part of the
    // literal path/profile, breaking Movement CLI argument parsing).
    const safeDir = validatePathSafety(dir, "package directory");
    const safeProfile = validateProfileSafety(profile);

    console.log(`📦 Publishing module "${moduleName}" from ${dir}...`);

    try {
      // Get the deployer address to use for named addresses
      const deployerAddress = account.accountAddress.toString();

      // Detect named addresses from Move files
      const { extractNamedAddresses } = await import("./commands/compile.js");
      const detectedAddresses = extractNamedAddresses(dir);

      // Build named addresses argument - use deployer address for all detected addresses.
      // Stored as a pre-split args fragment so the spawn path never has to parse
      // shell tokens; an empty fragment becomes a no-op via spread.
      const namedAddrArgs: string[] = detectedAddresses.size > 0
        ? [
            "--named-addresses",
            Array.from(detectedAddresses)
              .map(name => `${name}=${deployerAddress}`)
              .join(","),
          ]
        : [];

      // Build first with named addresses
      console.log("🔨 Building package...");
      const buildResult = await runCli(
        {
          command: "movement",
          args: ["move", "build", "--package-dir", safeDir, ...namedAddrArgs],
          timeoutMs: 120000, // 2 minutes for git dependency downloads
        },
        { adapter: options?.adapter }
      );
      if (buildResult.stdout) console.log(buildResult.stdout.trim());

      // Publish using direct parameters (avoid config file issues)
      console.log("📤 Publishing to blockchain...");

      // Use parameters directly instead of relying on config file
      // Strip any ed25519-priv- prefix if present
      let cleanPrivateKey = config.privateKey;
      if (cleanPrivateKey.startsWith('ed25519-priv-')) {
        cleanPrivateKey = cleanPrivateKey.replace('ed25519-priv-', '');
      }

      // deployerAddress is already declared above

      // Read Move.toml to update named addresses with deployer address
      const moveTomlPath = join(dir, 'Move.toml');
      let originalMoveToml = '';

      if (existsSync(moveTomlPath)) {
        const { readFile, writeFile } = await import('fs').then(fs => fs.promises);
        originalMoveToml = await readFile(moveTomlPath, 'utf-8');

        // Replace addresses in [addresses] section with deployer address
        const updatedMoveToml = originalMoveToml.replace(
          /\[addresses\]([\s\S]*?)(?=\n\[|$)/,
          (match, addressesSection) => {
            const updatedSection = addressesSection.replace(
              /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"0x[a-fA-F0-9]+"/gm,
              `$1 = "${deployerAddress}"`
            );
            return `[addresses]${updatedSection}`;
          }
        );

        // Write updated Move.toml temporarily
        await writeFile(moveTomlPath, updatedMoveToml, 'utf-8');
      }

      let publishOut = '';
      let publishErr = '';

      // Setup Movement CLI config with private key securely
      // Movement CLI uses .aptos config directory (not .movement)
      const movementConfigDir = join(homedir(), '.aptos');
      const movementConfigPath = join(movementConfigDir, 'config.yaml');
      let originalMovementConfig = '';

      try {
        // Ensure .aptos directory exists
        if (!existsSync(movementConfigDir)) {
          mkdirSync(movementConfigDir, { recursive: true, mode: 0o700 });
        }

        // Backup original config if it exists
        if (existsSync(movementConfigPath)) {
          const { readFile } = await import('fs').then(fs => fs.promises);
          originalMovementConfig = await readFile(movementConfigPath, 'utf-8');
        }

        // Create Movement config with private key
        // Movement CLI reads from ~/.aptos/config.yaml
        const movementConfig: any = originalMovementConfig ? yaml.load(originalMovementConfig) : {};

        // Set profile with private key
        // Use unescaped profile name as YAML key (YAML handles escaping automatically)
        if (!movementConfig.profiles) {
          movementConfig.profiles = {};
        }
        if (!movementConfig.profiles[profile]) {
          movementConfig.profiles[profile] = {};
        }

        movementConfig.profiles[profile].private_key = cleanPrivateKey;
        movementConfig.profiles[profile].public_key = account.publicKey.toString();
        movementConfig.profiles[profile].account = deployerAddress;
        movementConfig.profiles[profile].rest_url = config.rpc;

        // Write config file with restrictive permissions
        const configYaml = yaml.dump(movementConfig);
        writeFileSync(movementConfigPath, configYaml, { mode: 0o600 });

        // Execute publish command without exposing private key in CLI.
        // Routed through runCli so stdout/stderr are redacted of any
        // `ed25519-priv-…` shape before reaching console.log/console.error
        // or the thrown CliExecutionError — that's bug #43.
        const publishResult = await runCli(
          {
            command: "movement",
            args: [
              "move", "publish",
              "--package-dir", safeDir,
              "--url", config.rpc,
              "--profile", safeProfile,
              "--assume-yes",
              ...namedAddrArgs,
            ],
            timeoutMs: 120000, // 2 minutes for blockchain transactions
          },
          { adapter: options?.adapter }
        );
        publishOut = publishResult.stdout;
        publishErr = publishResult.stderr;
        if (publishOut) console.log(publishOut.trim());
        if (publishErr) console.error(publishErr.trim());
      } finally {
        // Restore original Movement config
        if (existsSync(movementConfigPath)) {
          if (originalMovementConfig) {
            // Restore original config
            writeFileSync(movementConfigPath, originalMovementConfig, { mode: 0o600 });
          } else {
            // Remove config file if it didn't exist before
            const { unlink } = await import('fs').then(fs => fs.promises);
            await unlink(movementConfigPath).catch(() => {});
          }
        }

        // Restore original Move.toml
        if (originalMoveToml && existsSync(moveTomlPath)) {
          const { writeFile } = await import('fs').then(fs => fs.promises);
          await writeFile(moveTomlPath, originalMoveToml, 'utf-8');
        }
      }

      // Extract transaction hash from output
      // Look for patterns like "Transaction hash: 0x..." or "Txn: 0x..." or just a 64-char hex
      // The regex tries to match with context first, then falls back to any 64-char hex
      let txHash: string | undefined;
      const txHashMatchWithContext = publishOut.match(/(?:transaction\s*(?:hash)?|txn\s*(?:hash)?|hash):\s*(0x[a-fA-F0-9]{64})\b/i);
      if (txHashMatchWithContext) {
        txHash = txHashMatchWithContext[1];
      } else {
        // Fallback: try to find any 64-char hex string (exactly, not more)
        const txHashMatch = publishOut.match(/\b(0x[a-fA-F0-9]{64})\b/);
        if (txHashMatch) {
          txHash = txHashMatch[1];
        }
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
      if (error instanceof CliExecutionError) {
        // stdout/stderr are already redacted by runCli before reaching here,
        // so this branch is safe to log verbatim.
        if (error.stdoutPreview) console.log(error.stdoutPreview);
        console.error(`❌ Failed to publish module: ${error.message}\n${error.stderr}`);
      } else {
        // Preserve existing behaviour for non-CLI errors (filesystem write
        // failures from Move.toml / ~/.aptos/config.yaml, yaml parse errors,
        // etc.). These paths can't carry private-key material so logging raw
        // is safe.
        const errorMsg = error.stderr ? `${error.message}\n${error.stderr}` : error.message;
        if (error.stdout) console.log(error.stdout);
        console.error(`❌ Failed to publish module: ${errorMsg}`);
      }
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
    return AccountManager.createAccount();
  };

  const getAccountHelper = (privateKeyHex: string): Account => {
    return AccountManager.loadAccountFromPrivateKey(privateKeyHex);
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
