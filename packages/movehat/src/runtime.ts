import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import { MovehatRuntime, NetworkInfo } from "./types/runtime.js";
import { MovehatConfig } from "./types/config.js";
import { loadUserConfig } from "./helpers/config.js";
import { getContract, MoveContract } from "./helpers/contract.js";

let cachedRuntime: MovehatRuntime | null = null;

/**
 * Initialize the Movehat Runtime Environment
 * This function loads the configuration and creates the runtime context
 */
export async function initRuntime(
  configOverride?: Partial<MovehatConfig>
): Promise<MovehatRuntime> {
  // Load user config from movehat.config.ts
  const userConfig = await loadUserConfig();
  const config: MovehatConfig = { ...userConfig, ...configOverride };

  // Setup Aptos client
  const aptosConfig = new AptosConfig({
    network: config.network as Network,
    fullnode: config.rpc,
  });
  const aptos = new Aptos(aptosConfig);

  // Setup default account from config
  const privateKey = new Ed25519PrivateKey(config.privateKey);
  const account = Account.fromPrivateKey({ privateKey });

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

  // Build runtime object
  const runtime: MovehatRuntime = {
    config,
    network,
    aptos,
    account,
    getContract: getContractHelper,
    deployContract,
    createAccount,
    getAccount: getAccountHelper,
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
