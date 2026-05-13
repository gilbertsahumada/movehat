// Type declarations for movehat package
// This file is only for IDE support during template development
// It will NOT be copied to user projects

declare module 'movehat' {
  import { Aptos, Account } from '@aptos-labs/ts-sdk';

  export interface NetworkInfo {
    name: string;
    rpc: string;
    chainId?: string;
  }

  export interface MovehatConfig {
    network: string;
    rpc: string;
    privateKey: string;
    profile: string;
    moveDir: string;
    account: string;
    namedAddresses?: Record<string, string>;
  }

  export interface DeploymentInfo {
    address: string;
    moduleName: string;
    network: string;
    deployer: string;
    timestamp: number;
    txHash?: string;
    blockNumber?: string;
  }

  export interface MovehatRuntime {
    config: MovehatConfig;
    network: NetworkInfo;
    aptos: Aptos;
    account: Account;
    accounts: Account[];
    getContract: (address: string, moduleName: string) => any;
    deployContract: (
      moduleName: string,
      options?: {
        packageDir?: string;
      }
    ) => Promise<DeploymentInfo>;
    getDeployment: (moduleName: string) => DeploymentInfo | null;
    getDeployments: () => Record<string, DeploymentInfo>;
    getDeploymentAddress: (moduleName: string) => string | null;
    createAccount: () => Account;
    getAccount: (privateKey: string) => Account;
    getAccountByIndex: (index: number) => Account;
    switchNetwork: (networkName: string) => Promise<MovehatRuntime>;
  }

  // getMovehat is a thin alias of initRuntime as of M1.5 — each call
  // constructs a fresh runtime. The previous cached behavior is gone.
  export function getMovehat(): Promise<MovehatRuntime>;
  export function initRuntime(configOverride?: Partial<MovehatConfig>): Promise<MovehatRuntime>;
}

declare module 'movehat/helpers' {
  import { Account, Aptos } from '@aptos-labs/ts-sdk';

  export interface TestEnvironment {
    aptos: Aptos;
    account: Account;
    config: import('movehat').MovehatConfig;
  }

  export class MoveContract {
    constructor(aptos: Aptos, address: string, moduleName: string);
    // args: any[] mirrors the runtime declaration — Move entry-function
    // arguments are heterogeneous primitives validated by the Aptos SDK
    // at submit time.
    call(sender: Account, functionName: string, args: any[]): Promise<TransactionResult>;
    view<T>(functionName: string, args: any[]): Promise<T>;
  }

  export interface TransactionResult {
    hash: string;
    success: boolean;
  }

  export interface DeploymentInfo {
    address: string;
    moduleName: string;
    network: string;
    deployer: string;
    timestamp: number;
    txHash?: string;
    blockNumber?: string;
  }

  export function setupTestEnvironment(): Promise<TestEnvironment>;
  export function createTestAccount(): Account;
  export function getContract(aptos: Aptos, address: string, moduleName: string): MoveContract;
  export function assertTransactionSuccess(result: TransactionResult): void;
  export function assertTransactionFailed(result: TransactionResult): void;
  export function saveDeployment(deployment: DeploymentInfo): void;
  export function loadDeployment(network: string, moduleName: string): DeploymentInfo | null;
  export function getAllDeployments(network: string): Record<string, DeploymentInfo>;
  export function getDeployedAddress(network: string, moduleName: string): string | null;
}
