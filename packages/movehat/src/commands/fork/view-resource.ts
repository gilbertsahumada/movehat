import { join } from 'path';
import { ForkManager } from '../../fork/manager.js';

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

    console.log(`\n🔍 Viewing resource from fork`);
    console.log(`   Fork: ${forkPath}`);
    console.log(`   Account: ${options.account}`);
    console.log(`   Resource: ${options.resource}\n`);

    // Load fork
    const forkManager = new ForkManager(forkPath);
    forkManager.load();

    // Get resource
    const resource = await forkManager.getResource(options.account, options.resource);

    // Display result
    console.log(JSON.stringify(resource, null, 2));
    console.log('');

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}
