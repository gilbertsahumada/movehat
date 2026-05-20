import { basename, join } from 'path';
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

const SAFE_FORK_NAME_RE = /^[A-Za-z0-9._-]+$/;
const RESERVED_FORK_NAMES = new Set(['.', '..']);

export function validateForkName(name: string): string {
  if (name.length === 0) {
    throw new Error('Invalid fork name: name must not be empty');
  }

  if (
    RESERVED_FORK_NAMES.has(name) ||
    basename(name) !== name ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    !SAFE_FORK_NAME_RE.test(name)
  ) {
    throw new Error(
      'Invalid fork name: use only letters, numbers, dot, underscore, and dash; path separators and traversal are not allowed'
    );
  }

  return name;
}

/**
 * Create a local fork of a Movement network
 *
 * This command:
 * - Connects to the specified network RPC endpoint
 * - Downloads blockchain state (accounts, modules, resources)
 * - Creates a local fork database for testing
 * - Displays fork metadata (chain ID, ledger version, block height, epoch)
 *
 * @param options - Fork creation options
 * @param options.network - Network to fork from (e.g., 'testnet', 'mainnet')
 * @param options.path - Custom path to store fork data
 * @param options.name - Custom name for the fork
 *
 * @example
 * // Fork testnet
 * await forkCreateCommand({ network: 'testnet' });
 *
 * @example
 * // Fork with custom name
 * await forkCreateCommand({ network: 'testnet', name: 'my-fork' });
 */
export default async function forkCreateCommand(options: ForkCreateOptions = {}) {
  try {
    // Load MoveHat config
    const userConfig = await loadUserConfig();
    const networkName = options.network || process.env.MH_CLI_NETWORK || userConfig.defaultNetwork || 'testnet';
    const networkConfig = await resolveNetworkConfig(userConfig, networkName);

    // Determine fork name and path
    const forkName = validateForkName(options.name || `${networkName}-fork`);
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

  } catch (error) {
    logger.newline();
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Error: ${msg}`);
    logger.newline();
    process.exit(1);
  }
}
