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
  loadDeployment,
  getAllDeployments,
  getDeployedAddress,
  DeploymentInfo,
} from "./core/deployments.js";
import { AccountManager } from "./core/AccountManager.js";
import { Publisher } from "./core/Publisher.js";
import type { ChildProcessAdapter } from "./utils/childProcessAdapter.js";

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
    // Thin orchestrator over Publisher (M1.4 / #79). The 250-line closure
    // body lives in core/Publisher.ts and carries the bug fixes for
    // #36 / #37 / #38.
    return new Publisher({ adapter: options?.adapter }).deploy({
      moduleName,
      config,
      account,
      packageDir: options?.packageDir,
    });
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
    const acc = accounts[index];
    if (!acc) {
      throw new Error(`Account index ${index} out of range. Available accounts: 0-${accounts.length - 1}`);
    }
    return acc;
  };

  const switchNetwork = async (networkName: string): Promise<MovehatRuntime> => {
    return initRuntime({ ...options, network: networkName });
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

  return runtime;
}

/**
 * Get the Movehat Runtime Environment.
 *
 * As of M1.5 this is a thin alias of {@link initRuntime} — each call
 * constructs a fresh runtime. The previous module-cached behavior was
 * removed because it leaked state between parallel tests and hid the
 * runtime dependency from script signatures.
 */
export async function getMovehat(): Promise<MovehatRuntime> {
  return initRuntime();
}
