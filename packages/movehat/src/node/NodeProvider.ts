import type { Account } from "@aptos-labs/ts-sdk";
import type { LocalNodeInfo } from "./LocalNodeManager.js";

export interface NodeProvider {
  start(): Promise<LocalNodeInfo>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getNodeInfo(): LocalNodeInfo;
  fundAccounts(accounts: Account[], balance: number): Promise<void>;
}
