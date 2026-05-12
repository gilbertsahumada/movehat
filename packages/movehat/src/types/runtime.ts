import { Aptos, Account } from "@aptos-labs/ts-sdk";
import { MovehatConfig } from "./config.js";
import { MoveContract } from "../core/contract.js";
import { DeploymentInfo } from "../core/deployments.js";
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

  // Aptos client instance
  aptos: Aptos;

  // Default account from config (accounts[0])
  account: Account;

  // All accounts for this network
  accounts: Account[];

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
    }
  ) => Promise<DeploymentInfo>;
  getDeployment: (moduleName: string) => DeploymentInfo | null;
  getDeployments: () => Record<string, DeploymentInfo>;
  getDeploymentAddress: (moduleName: string) => string | null;

  // Account management
  createAccount: () => Account;
  getAccount: (privateKey: string) => Account;
  getAccountByIndex: (index: number) => Account;

  // Network switching
  switchNetwork: (networkName: string) => Promise<void>;
}
