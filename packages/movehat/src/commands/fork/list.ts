import { join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { ForkStorage } from '../../fork/storage.js';
import { logger, createTable, formatCommand } from '../../ui/index.js';

/**
 * List all available local forks
 *
 * Displays forks in a formatted table showing:
 * - Fork name
 * - Network (testnet, mainnet, etc.)
 * - Chain ID
 * - Number of accounts
 * - Creation timestamp
 *
 * @example
 * // List all forks
 * await forkListCommand();
 */
export default async function forkListCommand() {
  try {
    const forksDir = join(process.cwd(), '.movehat', 'forks');

    if (!existsSync(forksDir)) {
      logger.newline();
      logger.info('No forks found');
      logger.newline();
      logger.plain('Create a fork with:');
      logger.item(formatCommand('movehat fork create --network testnet'), 2);
      logger.newline();
      return;
    }

    const entries = readdirSync(forksDir);
    const forkDirs = entries.filter((entry) => {
      const fullPath = join(forksDir, entry);
      return statSync(fullPath).isDirectory();
    });

    if (forkDirs.length === 0) {
      logger.newline();
      logger.info('No forks found');
      logger.newline();
      return;
    }

    logger.newline();
    logger.info(`Found ${forkDirs.length} fork(s)`);
    logger.newline();

    // Create table for forks
    const table = createTable({
      head: ['Name', 'Network', 'Chain ID', 'Accounts', 'Created'],
      preset: 'default',
      colWidths: [20, 15, 12, 12, 25]
    });

    for (const forkDir of forkDirs) {
      const forkPath = join(forksDir, forkDir);
      const storage = new ForkStorage(forkPath);

      try {
        if (storage.exists()) {
          const metadata = storage.loadMetadata();
          const accounts = storage.listAccounts();

          table.push([
            forkDir,
            metadata.network,
            metadata.chainId.toString(),
            accounts.length.toString(),
            new Date(metadata.createdAt).toLocaleString()
          ]);
        } else {
          table.push([forkDir, 'invalid', '-', '-', 'missing metadata']);
        }
      } catch (error) {
        table.push([forkDir, 'error', '-', '-', 'error reading']);
      }
    }

    console.log(table.toString());
    logger.newline();

    // Usage examples
    logger.section('Usage');
    logger.item(formatCommand('movehat fork view-resource --fork <PATH> --account <ADDR> --resource <TYPE>'), 2);
    logger.item(formatCommand('movehat fork fund --fork <PATH> --account <ADDR> --amount <AMOUNT>'), 2);
    logger.newline();

  } catch (error) {
    logger.newline();
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Error: ${msg}`);
    logger.newline();
    process.exit(1);
  }
}
