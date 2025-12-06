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
    metadataBytes?: Uint8Array,
    byteCode?: Uint8Array
  ) => {
    // TODO: Implement deployment logic
    throw new Error("deployContract not implemented yet");
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
