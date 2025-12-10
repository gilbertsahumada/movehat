import { join } from 'path';
import { ForkManager } from '../helpers/fork-manager.js';

interface ForkFundOptions {
  fork?: string;
  account: string;
  amount: string;
  coinType?: string;
}

/**
 * Fork fund command: Fund an account in the fork
 */
export default async function forkFundCommand(options: ForkFundOptions) {
  try {
    if (!options.account) {
      throw new Error('--account is required');
    }

    if (!options.amount) {
      throw new Error('--amount is required');
    }

    const amount = parseInt(options.amount, 10);
    if (isNaN(amount) || amount <= 0) {
      throw new Error('--amount must be a positive number');
    }

    // Determine fork path
    const forkPath = options.fork || join(process.cwd(), '.movehat', 'forks', 'testnet-fork');
    const coinType = options.coinType || '0x1::aptos_coin::AptosCoin';

    console.log(`\n💰 Funding account in fork`);
    console.log(`   Fork: ${forkPath}`);
    console.log(`   Account: ${options.account}`);
    console.log(`   Amount: ${amount}`);
    console.log(`   Coin Type: ${coinType}\n`);

    // Load fork
    const forkManager = new ForkManager(forkPath);
    forkManager.load();

    // Fund account
    await forkManager.fundAccount(options.account, amount, coinType);

    // Verify
    const resourceType = `0x1::coin::CoinStore<${coinType}>`;
    const coinStore = await forkManager.getResource(options.account, resourceType);

    console.log(`\n✅ Account funded successfully!`);
    console.log(`   New balance: ${coinStore.coin.value}\n`);

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}
