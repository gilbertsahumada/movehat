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
  /**
   * Optional pre-constructed `AccountManager` instance. When supplied,
   * the returned runtime's `accountManager` field is THIS instance —
   * so labeled accounts created BEFORE `initRuntime` are visible on
   * the runtime. When omitted, `initRuntime` constructs a fresh
   * `new AccountManager()` per call.
   *
   * `setupLocalTesting` uses this option to thread one manager through
   * `createBatch` → `exportPrivateKeys` → `initRuntime` so the deployer
   * key it extracts ends up on the same manager the runtime exposes.
   */
  accountManager?: AccountManager;
  /**
   * movelite RPC base URL (already ending in `/v1`) enabling Foundry-style
   * execution traces on `contract.call(...)` at verbosity level >= 2. Set only
   * when the active backend is movelite (its `/transactions/trace` endpoint
   * does not exist on a real Movement node). When omitted, contracts use the
   * normal submit path and never trace.
   */
  traceRpcUrl?: string;
}

/**
 * Initialize the Movehat Runtime Environment.
 *
 * Lower-level construction utility — loads `movehat.config.ts`, resolves
 * the active network, and builds a `MovehatRuntime` bound to it. Used
 * internally by {@link Harness.createLive} (see `harness/Harness.ts`).
 *
 * **External callers should prefer the `Harness.create*` factories**
 * (`Harness.createLocal` / `createFork` / `createLive`) for the Hardhat-
 * style lifecycle + use-after-cleanup safety. `initRuntime` remains
 * exported as a public utility for advanced use cases that need to
 * skip the Harness abstraction (e.g. embedding movehat inside another
 * framework).
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

  // Setup Movement TypeScript SDK client
  // Movement Network uses custom chain IDs, so we need to use Network.CUSTOM
  // and let the SDK fetch the actual chainId from the node
  const aptosConfig = new AptosConfig({
    network: Network.CUSTOM,
    fullnode: config.rpc,
  });
  const aptos = new Aptos(aptosConfig);

  // Setup accounts using AccountManager. Use the caller-supplied
  // instance when threaded in (preserves labels created before
  // initRuntime); otherwise construct a fresh one.
  const accountManager = options.accountManager ?? new AccountManager();
  const accountIndex = options.accountIndex || 0;
  const accounts: Account[] = accountManager.loadAccountsFromConfig(config);

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
    return getContract(aptos, address, moduleName, options.traceRpcUrl);
  };

  const deployContract = async (
    moduleName: string,
    options?: {
      packageDir?: string;
      adapter?: ChildProcessAdapter;
      sdkPublish?: boolean;
      redeploy?: boolean;
    }
  ): Promise<DeploymentInfo> => {
    // Thin orchestrator; the actual logic lives in core/Publisher.ts.
    return new Publisher({ adapter: options?.adapter }).deploy({
      moduleName,
      config,
      account,
      packageDir: options?.packageDir,
      sdkPublish: options?.sdkPublish,
      redeploy: options?.redeploy,
      aptos,
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
    return accountManager.createAccount();
  };

  const getAccountHelper = (privateKeyHex: string): Account => {
    return accountManager.loadAccountFromPrivateKey(privateKeyHex);
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
    accountManager,
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

