import { join } from 'path';
import { existsSync } from 'fs';
import { loadUserConfig, resolveNetworkConfig } from '../../core/config.js';
import { ForkServer } from '../../fork/server.js';

interface ForkServeOptions {
  fork?: string;
  port?: number;
}

/**
 * Fork serve command: Start a local RPC server serving the fork
 */
export default async function forkServeCommand(options: ForkServeOptions): Promise<void> {
  try {
    // Determine fork path
    let forkPath: string;

    if (options.fork) {
      // Use specified path
      forkPath = options.fork;
    } else {
      // Use default fork path based on current network
      const config = await loadUserConfig();
      const networkName = process.env.MH_CLI_NETWORK || config.defaultNetwork || 'testnet';
      await resolveNetworkConfig(config, networkName); // Validate network exists

      forkPath = join(process.cwd(), '.movehat', 'forks', `${networkName}-fork`);
    }

    // Verify fork exists
    if (!existsSync(join(forkPath, 'metadata.json'))) {
      console.error(`\nError: Fork not found at ${forkPath}`);
      console.error(`\nCreate a fork first with:`);
      console.error(`  movehat fork create --network <network> --name <name>`);
      process.exit(1);
    }

    // Get port
    const port = options.port || 8080;

    // Create and start server
    const server = new ForkServer(forkPath, port);

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n\nShutting down...');
      await server.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start server
    await server.start();

  } catch (error: any) {
    console.error(`\nError starting fork server:`, error.message);
    process.exit(1);
  }
}
