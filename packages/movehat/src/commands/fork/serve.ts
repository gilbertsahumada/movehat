import { join } from 'path';
import { existsSync } from 'fs';
import { loadUserConfig, resolveNetworkEndpoint } from '../../core/config.js';
import { ForkServer } from '../../fork/server.js';
import { logger } from '../../ui/index.js';

interface ForkServeOptions {
  fork?: string;
  port?: number;
  host?: string;
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
      // Resolve the default fork via the same central policy as `fork create`
      // (honors MH_CLI_NETWORK / MOVEHAT_NETWORK / MH_DEFAULT_NETWORK / config),
      // so both commands agree on which <network>-fork directory to use.
      // fork serve only reads data, so no signing account is required.
      const config = await loadUserConfig();
      const explicitNetwork = process.env.MH_CLI_NETWORK;
      let endpoint = resolveNetworkEndpoint(config);
      if (!explicitNetwork && (endpoint.network === 'local' || endpoint.network === 'movelite')) {
        // Forks are snapshots of remote networks; a local default cannot
        // name one, so serve the conventional testnet fork instead.
        endpoint = resolveNetworkEndpoint(config, 'testnet');
      }

      forkPath = join(process.cwd(), '.movehat', 'forks', `${endpoint.network}-fork`);
    }

    // Verify fork exists
    if (!existsSync(join(forkPath, 'metadata.json'))) {
      logger.newline();
      logger.error(`Fork not found at ${forkPath}`);
      logger.newline();
      logger.error("Create a fork first with:");
      logger.error("  movehat fork create --network <network> --name <name>");
      process.exit(1);
    }

    // Get port (already validated by Commander's parsePort in cli.ts)
    const port = options.port ?? 8080;
    const host = options.host ?? '127.0.0.1';

    // Create and start server
    const server = new ForkServer(forkPath, port, host);

    // Handle graceful shutdown (use 'once' to prevent duplicate shutdowns)
    const shutdown = async () => {
      logger.newline();
      logger.step("Shutting down...");
      await server.stop();
      process.exit(0);
    };

    // Use named handlers so we can remove them if needed
    const sigintHandler = () => { void shutdown(); };
    const sigtermHandler = () => { void shutdown(); };

    process.once('SIGINT', sigintHandler);
    process.once('SIGTERM', sigtermHandler);

    try {
      // Start server
      await server.start();
    } finally {
      // Remove handlers in case server is stopped by other means
      process.removeListener('SIGINT', sigintHandler);
      process.removeListener('SIGTERM', sigtermHandler);
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.newline();
    logger.error(`Error starting fork server: ${msg}`);
    process.exit(1);
  }
}
