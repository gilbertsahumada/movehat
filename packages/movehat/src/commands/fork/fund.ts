import { join } from 'path';
import { ForkManager } from '../../fork/manager.js';
import { logger } from '../../ui/index.js';

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

    logger.newline();
    logger.step("Funding account in fork");
    logger.plain(`   Fork: ${forkPath}`);
    logger.plain(`   Account: ${options.account}`);
    logger.plain(`   Amount: ${amount}`);
    logger.plain(`   Coin Type: ${coinType}`);
    logger.newline();

    // Load fork
    const forkManager = new ForkManager(forkPath);
    forkManager.load();

    // Fund account
    await forkManager.fundAccount(options.account, amount, coinType);

    // Verify
    const resourceType = `0x1::coin::CoinStore<${coinType}>`;
    const coinStore = await forkManager.getResource(options.account, resourceType);

    logger.newline();
    logger.success("Account funded successfully!");
    logger.plain(`   New balance: ${coinStore.coin.value}`);
    logger.newline();

  } catch (error: any) {
    logger.newline();
    logger.error(error.message);
    logger.newline();
    process.exit(1);
  }
}
