import { pathToFileURL } from "url";
import { join } from "path";
import { existsSync } from "fs";
import { MovehatConfig, MovehatUserConfig, NetworkConfig } from "../types/config.js";

/**
 * Loads the user's movehat.config.js from the current working directory.
 * 
 * @throws {Error} If the configuration file is not found or fails to load
 * @security This function loads and executes code from the current working directory.
 *           It should only be called from trusted project directories.
 */
export async function loadUserConfig(): Promise<MovehatUserConfig> {
  const cwd = process.cwd();

  // Try to find config file (.ts first, then .js)
  const possiblePaths = [
    join(cwd, "movehat.config.ts"),
    join(cwd, "movehat.config.js"),
  ];

  let configPath: string | null = null;
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      configPath = path;
      break;
    }
  }

  if (!configPath) {
    throw new Error(
      "Configuration file not found. Expected 'movehat.config.ts' or 'movehat.config.js' in the current directory."
    );
  }

  try {
    let configModule;

    if (configPath.endsWith('.ts')) {
      // For TypeScript files, we need to use tsx's import system
      // Register tsx loader for .ts files
      const { register } = await import('tsx/esm/api');
      const unregister = register();

      try {
        const configUrl = pathToFileURL(configPath).href;
        configModule = await import(configUrl + '?t=' + Date.now());
      } finally {
        unregister();
      }
    } else {
      // For .js files, use standard import
      const configUrl = pathToFileURL(configPath).href;
      configModule = await import(configUrl + '?t=' + Date.now());
    }

    const userConfig = configModule.default as MovehatUserConfig;

    // Validate that networks are defined
    if (!userConfig.networks || Object.keys(userConfig.networks).length === 0) {
      throw new Error(
        "No networks defined in configuration. Add at least one network in the 'networks' field."
      );
    }

    return userConfig;
  } catch (error) {
    throw new Error(`Failed to load configuration file '${configPath}': ${error}`);
  }
}

/**
 * Resolve configuration for a specific network
 * Merges global settings with network-specific settings
 */
export async function resolveNetworkConfig(
  userConfig: MovehatUserConfig,
  networkName?: string
): Promise<MovehatConfig> {
  // Determine which network to use
  const selectedNetwork =
    networkName ||
    process.env.MH_CLI_NETWORK ||
    process.env.MH_DEFAULT_NETWORK ||
    userConfig.defaultNetwork ||
    "testnet";

  // Check if network exists in config
  const networkConfig = userConfig.networks[selectedNetwork];
  if (!networkConfig) {
    const availableNetworks = Object.keys(userConfig.networks).join(", ");
    throw new Error(
      `Network '${selectedNetwork}' not found in configuration.\nAvailable networks: ${availableNetworks}`
    );
  }

  // Get accounts with environment variable support
  const networkEnvPrefix = `MH_${selectedNetwork.toUpperCase()}_PRIVATE_KEY`;
  const globalEnvKey = process.env.MH_PRIVATE_KEY;
  const networkEnvKey = process.env[networkEnvPrefix];

  let accounts = [...networkConfig.accounts];

  // If env var is set, use it (prepend to accounts array)
  if (networkEnvKey) {
    accounts = [networkEnvKey, ...accounts.filter(a => a !== networkEnvKey)];
  } else if (globalEnvKey && accounts.length === 0) {
    // Fallback to global env var if no accounts configured
    accounts = [globalEnvKey];
  }

  // Validate we have at least one account
  if (accounts.length === 0 || !accounts[0]) {
    throw new Error(
      `Network '${selectedNetwork}' has no accounts configured.\n` +
      `Set ${networkEnvPrefix} in your .env file or configure accounts in movehat.config.ts`
    );
  }

  // Merge named addresses (network-specific overrides global)
  const mergedNamedAddresses = {
    ...(userConfig.namedAddresses || {}),
    ...(networkConfig.namedAddresses || {}),
  };

  // Build resolved config
  const resolvedConfig: MovehatConfig = {
    network: selectedNetwork,
    rpc: networkConfig.url,
    privateKey: accounts[0],
    allAccounts: accounts,
    profile: networkConfig.profile || "default",
    moveDir: userConfig.moveDir || "./move",
    account: "", // Will be derived from privateKey in runtime
    namedAddresses: mergedNamedAddresses,
    networkConfig: networkConfig,
  };

  return resolvedConfig;
}
