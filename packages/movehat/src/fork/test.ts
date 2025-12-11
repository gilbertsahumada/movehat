import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync } from 'fs';

const execFileAsync = promisify(execFile);

export interface SnapshotOptions {
  path?: string;
  name?: string;
}

export interface ForkInfo {
  path: string;
  networkVersion?: number;
  nodeUrl?: string;
  exists: boolean;
}

/**
 * Create a snapshot (fork) of the current network state
 * Useful for debugging test failures or inspecting state after tests
 *
 * @param options - Snapshot configuration
 * @returns Path to the created snapshot
 *
 * @example
 * ```typescript
 * // In your test
 * after(async () => {
 *   const snapshotPath = await snapshot({ name: 'after-counter-test' });
 *   console.log(`Snapshot saved to ${snapshotPath}`);
 * });
 * ```
 */
export async function snapshot(options: SnapshotOptions = {}): Promise<string> {
  const name = options.name || `snapshot-${Date.now()}`;
  const snapshotPath = options.path || join(process.cwd(), '.movehat', 'snapshots', name);

  console.log(`📸 Creating snapshot: ${name}...`);

  try {
    // Initialize fork/snapshot using aptos CLI
    // Use execFile with argument array to prevent command injection
    const { stdout, stderr } = await execFileAsync('aptos', [
      'move',
      'sim',
      'init',
      '--path',
      snapshotPath
    ]);

    if (stderr && !stderr.includes('Success')) {
      throw new Error(stderr);
    }

    if (!existsSync(snapshotPath)) {
      throw new Error('Snapshot directory was not created');
    }

    console.log(`   ✓ Snapshot created at ${snapshotPath}`);
    return snapshotPath;
  } catch (error: any) {
    throw new Error(`Failed to create snapshot: ${error.message}`);
  }
}

/**
 * Get information about a fork/snapshot
 *
 * @param path - Path to the fork directory
 * @returns Fork information
 */
export async function getForkInfo(path: string): Promise<ForkInfo> {
  const configPath = join(path, 'config.json');

  if (!existsSync(configPath)) {
    return {
      path,
      exists: false
    };
  }

  try {
    const fs = await import('fs/promises');
    const configContent = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);

    return {
      path,
      exists: true,
      networkVersion: config.base?.Remote?.network_version,
      nodeUrl: config.base?.Remote?.node_url
    };
  } catch (error) {
    return {
      path,
      exists: false
    };
  }
}

/**
 * View a resource from a fork/snapshot
 * Useful for inspecting state without modifying it
 *
 * @param sessionPath - Path to the fork session
 * @param account - Account address
 * @param resourceType - Full resource type (e.g., '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>')
 * @returns Resource data
 *
 * @example
 * ```typescript
 * const balance = await viewForkResource(
 *   '.movehat/snapshots/test-snapshot',
 *   '0x123...',
 *   '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
 * );
 * console.log(`Balance: ${balance.coin.value}`);
 * ```
 */
export async function viewForkResource(
  sessionPath: string,
  account: string,
  resourceType: string
): Promise<any> {
  try {
    // Use execFile with argument array to prevent command injection
    const { stdout } = await execFileAsync('aptos', [
      'move',
      'sim',
      'view-resource',
      '--session',
      sessionPath,
      '--account',
      account,
      '--resource',
      resourceType
    ]);

    const result = JSON.parse(stdout);

    if (result.Error) {
      throw new Error(result.Error);
    }

    return result.Result;
  } catch (error: any) {
    throw new Error(`Failed to view resource: ${error.message}`);
  }
}

/**
 * Compare a resource between current network state and a fork
 * Useful for verifying state changes after tests
 *
 * @param forkPath - Path to the fork
 * @param account - Account address
 * @param resourceType - Resource type to compare
 * @param currentValue - Current value from network (pass from your test)
 * @returns Comparison result
 */
export async function compareForkState(
  forkPath: string,
  account: string,
  resourceType: string,
  currentValue: any
): Promise<{ fork: any; current: any; changed: boolean }> {
  const forkValue = await viewForkResource(forkPath, account, resourceType);

  return {
    fork: forkValue,
    current: currentValue,
    changed: JSON.stringify(forkValue) !== JSON.stringify(currentValue)
  };
}

/**
 * List all snapshots in the project
 * @returns Array of snapshot paths
 */
export async function listSnapshots(): Promise<string[]> {
  const snapshotsDir = join(process.cwd(), '.movehat', 'snapshots');

  if (!existsSync(snapshotsDir)) {
    return [];
  }

  const fs = await import('fs/promises');
  const entries = await fs.readdir(snapshotsDir, { withFileTypes: true });

  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => join(snapshotsDir, entry.name));
}
