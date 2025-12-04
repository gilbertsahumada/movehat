import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import { loadUserConfig } from "./config.js";

const config = await loadUserConfig();

export interface TestEnvironment {
  aptos: Aptos;
  account: Account;
  config: typeof config;
}

export async function setupTestEnvironment(): Promise<TestEnvironment> {
  const aptosConfig = new AptosConfig({
    network: config.network as Network,
    fullnode: config.rpc,
  });

  const aptos = new Aptos(aptosConfig);

  const privateKey = new Ed25519PrivateKey(config.privateKey);
  const account = Account.fromPrivateKey({ privateKey });

  console.log(`✅ Test environment ready`);
  console.log(`   Account: ${account.accountAddress.toString()}`);
  console.log(`   Network: ${config.network}`);
  console.log(`   RPC: ${config.rpc}\n`);

  return {
    aptos,
    account,
    config,
  }
}

export function createTestAccount(): Account { 
    return Account.generate();
}


