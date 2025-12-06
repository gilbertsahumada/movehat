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

  export interface MovehatRuntime {
    config: MovehatConfig;
    network: NetworkInfo;
    aptos: Aptos;
    account: Account;
    getContract: (address: string, moduleName: string) => any;
    deployContract: (moduleName: string, metadataBytes?: Uint8Array, byteCode?: Uint8Array) => Promise<any>;
    createAccount: () => Account;
    getAccount: (privateKey: string) => Account;
  }

  export function getMovehat(): Promise<MovehatRuntime>;
  export function initRuntime(configOverride?: Partial<MovehatConfig>): Promise<MovehatRuntime>;
  export function getRuntime(): MovehatRuntime;

  export const mh: {
    readonly runtime: MovehatRuntime;
  };
}

declare module 'movehat/helpers' {
  import { Account, Aptos } from '@aptos-labs/ts-sdk';

  export interface TestEnvironment {
    aptos: Aptos;
    account: Account;
    config: any;
  }

  export class MoveContract {
    constructor(aptos: Aptos, address: string, moduleName: string);
    call(sender: Account, functionName: string, args: any[]): Promise<any>;
    view<T>(functionName: string, args: any[]): Promise<T>;
  }

  export interface TransactionResult {
    hash: string;
    success: boolean;
  }

  export function setupTestEnvironment(): Promise<TestEnvironment>;
  export function createTestAccount(): Account;
  export function getContract(aptos: Aptos, address: string, moduleName: string): MoveContract;
  export function assertTransactionSuccess(result: TransactionResult): void;
  export function assertTransactionFailed(result: TransactionResult): void;
}
