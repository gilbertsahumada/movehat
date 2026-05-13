import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import { loadUserConfig, resolveNetworkConfig } from "../core/config.js";
import { MovehatConfig } from "../types/config.js";
import { AccountManager } from "../core/AccountManager.js";
import { logger } from "../ui/index.js";

export interface TestEnvironment {
  aptos: Aptos;
  account: Account;
  config: MovehatConfig;
}

export async function setupTestEnvironment(networkName?: string): Promise<TestEnvironment> {
  // Load and resolve config for selected network
  const userConfig = await loadUserConfig();
  const network = networkName || process.env.MH_CLI_NETWORK;
  const config = await resolveNetworkConfig(userConfig, network);

  // Movement Network uses custom chain IDs, so we need to use Network.CUSTOM
  // and let the SDK fetch the actual chainId from the node
  const aptosConfig = new AptosConfig({
    network: Network.CUSTOM,
    fullnode: config.rpc,
  });

  const aptos = new Aptos(aptosConfig);

  // Load account using AccountManager
  const account = AccountManager.loadAccountFromPrivateKey(config.privateKey);

  logger.success("Test environment ready");
  logger.plain(`   Account: ${account.accountAddress.toString()}`);
  logger.plain(`   Network: ${config.network}`);
  logger.plain(`   RPC: ${config.rpc}`);
  logger.newline();

  return {
    aptos,
    account,
    config,
  }
}

export function createTestAccount(): Account {
    return AccountManager.createAccount();
}


