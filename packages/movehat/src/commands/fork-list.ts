import { join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { ForkStorage } from '../helpers/fork-storage.js';

/**
 * Fork list command: List all available forks
 */
export default async function forkListCommand() {
  try {
    const forksDir = join(process.cwd(), '.movehat', 'forks');

    if (!existsSync(forksDir)) {
      console.log('\n📂 No forks found\n');
      console.log('Create a fork with:');
      console.log('  movehat fork create --network testnet\n');
      return;
    }

    const entries = readdirSync(forksDir);
    const forkDirs = entries.filter((entry) => {
      const fullPath = join(forksDir, entry);
      return statSync(fullPath).isDirectory();
    });

    if (forkDirs.length === 0) {
      console.log('\n📂 No forks found\n');
      return;
    }

    console.log(`\n📂 Found ${forkDirs.length} fork(s):\n`);

    for (const forkDir of forkDirs) {
      const forkPath = join(forksDir, forkDir);
      const storage = new ForkStorage(forkPath);

      try {
        if (storage.exists()) {
          const metadata = storage.loadMetadata();
          const accounts = storage.listAccounts();

          console.log(`  ${forkDir}`);
          console.log(`    Path: ${forkPath}`);
          console.log(`    Network: ${metadata.network}`);
          console.log(`    Chain ID: ${metadata.chainId}`);
          console.log(`    Ledger Version: ${metadata.ledgerVersion}`);
          console.log(`    Cached Accounts: ${accounts.length}`);
          console.log(`    Created: ${new Date(metadata.createdAt).toLocaleString()}`);
          console.log('');
        } else {
          console.log(`  ${forkDir} (invalid - missing metadata)`);
          console.log('');
        }
      } catch (error) {
        console.log(`  ${forkDir} (error reading metadata)`);
        console.log('');
      }
    }

    console.log('Usage:');
    console.log('  movehat fork view-resource --fork <PATH> --account <ADDR> --resource <TYPE>');
    console.log('  movehat fork fund --fork <PATH> --account <ADDR> --amount <AMOUNT>\n');

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}
