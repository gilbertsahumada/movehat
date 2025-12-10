import { join } from 'path';
import { existsSync } from 'fs';
import prompts from 'prompts';
import { loadUserConfig, resolveNetworkConfig } from '../helpers/config.js';
import { ForkManager } from '../helpers/fork-manager.js';

interface ForkCreateOptions {
  network?: string;
  path?: string;
  name?: string;
}

/**
 * Fork create command: Create a local fork of a Movement/Aptos network
 */
export default async function forkCreateCommand(options: ForkCreateOptions = {}) {
  try {
    // Load MoveHat config
    const userConfig = await loadUserConfig();
    const networkName = options.network || process.env.MH_CLI_NETWORK || userConfig.defaultNetwork || 'testnet';
    const networkConfig = await resolveNetworkConfig(userConfig, networkName);

    // Determine fork name and path
    const forkName = options.name || `${networkName}-fork`;
    const forkPath = options.path || join(process.cwd(), '.movehat', 'forks', forkName);

    console.log(`\n📦 Creating fork of ${networkName}`);
    console.log(`   Network: ${networkConfig.rpc}`);
    console.log(`   Fork path: ${forkPath}`);

    // Check if fork already exists
    if (existsSync(forkPath)) {
      const { overwrite } = await prompts({
        type: 'confirm',
        name: 'overwrite',
        message: `Fork already exists at ${forkPath}. Overwrite?`,
        initial: false,
      });

      if (!overwrite) {
        console.log('❌ Fork creation cancelled');
        return;
      }
    }

    // Create fork manager
    const forkManager = new ForkManager(forkPath);

    // Initialize fork
    console.log(`\n⚙️  Initializing fork...`);
    await forkManager.initialize(networkConfig.rpc, networkName);

    const metadata = forkManager.getMetadata();

    console.log(`\n✅ Fork created successfully!\n`);
    console.log(`Fork Details:`);
    console.log(`  Chain ID: ${metadata.chainId}`);
    console.log(`  Ledger Version: ${metadata.ledgerVersion}`);
    console.log(`  Block Height: ${metadata.blockHeight}`);
    console.log(`  Epoch: ${metadata.epoch}`);
    console.log(`\nUsage:`);
    console.log(`  movehat fork view-resource --fork ${forkPath} --account <ADDRESS> --resource <TYPE>`);
    console.log(`  movehat fork fund --fork ${forkPath} --account <ADDRESS> --amount <AMOUNT>`);
    console.log(`  movehat fork list\n`);

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}
