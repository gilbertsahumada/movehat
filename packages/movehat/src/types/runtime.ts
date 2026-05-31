import { Aptos, Account } from "@aptos-labs/ts-sdk";
import { MovehatConfig } from "./config.js";
import { MoveContract } from "../core/contract.js";
import { DeploymentInfo } from "../core/deployments.js";
import type { AccountManager } from "../core/AccountManager.js";
import type { ChildProcessAdapter } from "../utils/childProcessAdapter.js";

export interface NetworkInfo {
  name: string;
  rpc: string;
  chainId?: string;
}

export interface MovehatRuntime {
  // Core configuration
  config: MovehatConfig;

  // Network information
  network: NetworkInfo;

  // Movement TypeScript SDK client instance
  aptos: Aptos;

  // Default account from config (accounts[0])
  account: Account;

  // All accounts for this network
  accounts: Account[];

  // Per-runtime AccountManager instance. Holds the account pool +
  // label map scoped to this runtime — two `initRuntime()` calls
  // produce independent managers. Use `harness.accounts.<label>` for
  // the common read path; reach into this manager for advanced ops
  // (createBatch, exportPrivateKeys, saveAccountPool, etc.).
  accountManager: AccountManager;

  // Helper functions
  getContract: (address: string, moduleName: string) => MoveContract;

  // Deployment functions
  deployContract: (
    moduleName: string,
    options?: {
      packageDir?: string;
      /**
       * Override the child-process adapter. Test-only: production callers
       * leave this undefined so the default spawn-based adapter is used.
       */
      adapter?: ChildProcessAdapter;
      /**
       * Publish the compiled package via the TypeScript SDK instead of the
       * Movement CLI. Internal: setupLocalTesting sets this when the backend
       * is movelite, whose REST responses the Movement CLI cannot consume.
       */
      sdkPublish?: boolean;
    }
  ) => Promise<DeploymentInfo>;
  getDeployment: (moduleName: string) => DeploymentInfo | null;
  getDeployments: () => Record<string, DeploymentInfo>;
  getDeploymentAddress: (moduleName: string) => string | null;

  // Account management
  createAccount: () => Account;
  getAccount: (privateKey: string) => Account;
  getAccountByIndex: (index: number) => Account;

  // Network switching — returns a new runtime bound to the requested
  // network. There is no module-cached runtime, so callers must capture
  // and use the returned instance.
  switchNetwork: (networkName: string) => Promise<MovehatRuntime>;
}
