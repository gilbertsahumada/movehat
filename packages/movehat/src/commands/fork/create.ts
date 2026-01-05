import { join } from 'path';
import { existsSync } from 'fs';
import prompts from 'prompts';
import { loadUserConfig, resolveNetworkConfig } from '../../core/config.js';
import { ForkManager } from '../../fork/manager.js';
import { logger, withSpinner, createKVTable, formatCommand } from '../../ui/index.js';

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

    logger.newline();
    logger.info(`Creating fork of ${networkName}`);
    logger.kv('Network', networkConfig.rpc, 2);
    logger.kv('Fork path', forkPath, 2);
    logger.newline();

    // Check if fork already exists
    if (existsSync(forkPath)) {
      const { overwrite } = await prompts({
        type: 'confirm',
        name: 'overwrite',
        message: `Fork already exists at ${forkPath}. Overwrite?`,
        initial: false,
      });

      if (!overwrite) {
        logger.warning('Fork creation cancelled');
        return;
      }
    }

    // Create fork manager
    const forkManager = new ForkManager(forkPath);

    // Initialize fork with spinner
    const metadata = await withSpinner(
      'Initializing fork...',
      async () => {
        await forkManager.initialize(networkConfig.rpc, networkName);
        return forkManager.getMetadata();
      },
      'Fork initialized successfully!'
    );

    // Show fork details
    logger.newline();
    logger.success('Fork created successfully!');
    logger.newline();

    logger.section('Fork Details');
    const detailsTable = createKVTable({
      'Chain ID': metadata.chainId.toString(),
      'Ledger Version': metadata.ledgerVersion,
      'Block Height': metadata.blockHeight,
      'Epoch': metadata.epoch
    });
    console.log(detailsTable.toString());
    logger.newline();

    // Usage examples
    logger.section('Usage');
    logger.item(formatCommand(`movehat fork view-resource --fork ${forkPath} --account <ADDRESS> --resource <TYPE>`), 2);
    logger.item(formatCommand(`movehat fork fund --fork ${forkPath} --account <ADDRESS> --amount <AMOUNT>`), 2);
    logger.item(formatCommand('movehat fork list'), 2);
    logger.newline();

  } catch (error: any) {
    logger.newline();
    logger.error(`Error: ${error.message}`);
    logger.newline();
    process.exit(1);
  }
}
