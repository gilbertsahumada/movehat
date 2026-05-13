import { join } from 'path';
import { ForkManager } from '../../fork/manager.js';
import { logger } from '../../ui/index.js';

interface ForkViewResourceOptions {
  fork?: string;
  account: string;
  resource: string;
}

/**
 * Fork view-resource command: View a resource from the fork
 */
export default async function forkViewResourceCommand(options: ForkViewResourceOptions) {
  try {
    if (!options.account) {
      throw new Error('--account is required');
    }

    if (!options.resource) {
      throw new Error('--resource is required');
    }

    // Determine fork path
    const forkPath = options.fork || join(process.cwd(), '.movehat', 'forks', 'testnet-fork');

    logger.newline();
    logger.step("Viewing resource from fork");
    logger.plain(`   Fork: ${forkPath}`);
    logger.plain(`   Account: ${options.account}`);
    logger.plain(`   Resource: ${options.resource}`);
    logger.newline();

    // Load fork
    const forkManager = new ForkManager(forkPath);
    forkManager.load();

    // Get resource
    const resource = await forkManager.getResource(options.account, options.resource);

    // Display result
    console.log(JSON.stringify(resource, null, 2));
    console.log('');

  } catch (error) {
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}
