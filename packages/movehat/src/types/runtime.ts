import { Aptos, Account } from "@aptos-labs/ts-sdk";
import { MovehatConfig } from "./config.js";
import { MoveContract } from "../helpers/contract.js";

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
  deployContract: (moduleName: string, metadataBytes?: Uint8Array, byteCode?: Uint8Array) => Promise<any>;

  // Account management
  createAccount: () => Account;
  getAccount: (privateKey: string) => Account;
  getAccountByIndex: (index: number) => Account;

  // Network switching
  switchNetwork: (networkName: string) => Promise<void>;
}
