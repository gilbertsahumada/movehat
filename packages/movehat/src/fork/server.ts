import http from 'http';
import { URL } from 'url';
import { ForkManager } from './manager.js';

/**
 * Fork Server - Serves fork data via Movement L1 RPC API
 * Emulates a Movement L1 node using local fork storage
 */
export class ForkServer {
  private server: http.Server | null = null;
  private forkManager: ForkManager;
  private port: number;
  private host: string;

  /**
   * @param host Interface to bind. Defaults to `127.0.0.1` so cached fork
   *   state (which may include sensitive resources) is not exposed on the LAN.
   *   Pass `'0.0.0.0'` only if you intentionally need to expose the server.
   */
  constructor(forkPath: string, port: number = 8080, host: string = '127.0.0.1') {
    this.forkManager = new ForkManager(forkPath);
    this.port = port;
    this.host = host;
  }

  /**
   * Start the fork server
   */
  async start(): Promise<void> {
    // Load fork metadata
    this.forkManager.load();
    const metadata = this.forkManager.getMetadata();

    console.log(`\nStarting Fork Server...`);
    console.log(`  Network: ${metadata.network}`);
    console.log(`  Chain ID: ${metadata.chainId}`);
    console.log(`  Ledger Version: ${metadata.ledgerVersion}`);
    console.log(`  Forked at: ${metadata.createdAt}`);

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        // Log full error server-side for diagnostics
        console.error(`Error handling request:`, error);

        // Only send response if headers haven't been sent yet
        if (!res.headersSent) {
          // Add CORS headers (same as in handleRequest)
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

          // Send generic error response (no internal details exposed)
          this.sendJSON(res, 500, {
            message: 'Internal server error',
            error_code: 'internal_error',
            vm_error_code: null
          });
        }
      });
    });

    // Capture the just-assigned server into a non-null local so we don't
    // have to repeatedly assert `this.server!` (which TS forces because
    // `http.createServer` returns an unrelated narrow that the field
    // declaration doesn't track).
    const server = this.server;

    return new Promise((resolve, reject) => {
      // Handle server errors (port in use, permission denied, etc.)
      const onError = (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} is already in use. Please use a different port with --port <number>`));
        } else if (error.code === 'EACCES') {
          reject(new Error(`Permission denied to bind to port ${this.port}. Try using a port above 1024 or run with appropriate permissions.`));
        } else {
          reject(new Error(`Failed to start server: ${error.message}`));
        }
      };

      // Listen for errors during startup
      server.once('error', onError);

      server.listen(this.port, this.host, () => {
        // Remove error listener after successful start
        server.removeListener('error', onError);

        // IPv6 literals must be wrapped in brackets in URLs (RFC 3986).
        const isIpv6 = this.host.includes(':');
        const displayHost =
          this.host === '0.0.0.0'
            ? 'localhost'
            : isIpv6
              ? `[${this.host}]`
              : this.host;
        console.log(`\nFork Server listening on http://${displayHost}:${this.port}`);
        console.log(`  Bound interface: ${this.host}`);
        console.log(`  Ledger Info: http://${displayHost}:${this.port}/v1/`);
        if (this.host === '0.0.0.0') {
          console.warn(`  Server is bound to 0.0.0.0 — fork state is reachable from the LAN.`);
        }
        console.log(`\nPress Ctrl+C to stop`);
        resolve();
      });
    });
  }

  /**
   * Stop the fork server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('\nFork Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Sanitize pathname for error messages to prevent log injection
   */
  private sanitizePathname(pathname: string): string {
    // Remove control characters and newlines
    const sanitized = pathname.replace(/[\x00-\x1F\x7F]/g, '');
    // Truncate to reasonable length
    return sanitized.length > 100 ? sanitized.substring(0, 100) + '...' : sanitized;
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.port}`);
    const pathname = url.pathname;

    // Log request
    console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS for CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      // Route requests
      if (pathname === '/v1' || pathname === '/v1/') {
        await this.handleLedgerInfo(res);
      } else if (pathname.match(/^\/v1\/accounts\/0x[a-fA-F0-9]{1,64}$/)) {
        const address = pathname.split('/').pop()!;
        await this.handleGetAccount(address, res);
      } else if (pathname.match(/^\/v1\/accounts\/0x[a-fA-F0-9]{1,64}\/resource\/.+$/)) {
        const parts = pathname.split('/');
        const accountIndex = parts.indexOf('accounts') + 1;
        const resourceIndex = parts.indexOf('resource') + 1;
        const address = parts[accountIndex];
        const resourceType = decodeURIComponent(parts.slice(resourceIndex).join('/'));
        if (!address) {
          this.send404(res, 'Malformed resource path', 'malformed_path');
          return;
        }
        await this.handleGetResource(address, resourceType, res);
      } else {
        // Use regex capture for resources endpoint
        const resourcesMatch = pathname.match(/^\/v1\/accounts\/(0x[a-fA-F0-9]{1,64})\/resources$/);
        if (resourcesMatch && resourcesMatch[1]) {
          const address = resourcesMatch[1];
          await this.handleGetResources(address, res);
        } else {
          // Sanitize pathname to prevent log injection
          const safePath = this.sanitizePathname(pathname);
          this.send404(res, `Endpoint not found: ${safePath}`, 'endpoint_not_found');
        }
      }
    } catch (error) {
      // Log full error server-side for diagnostics
      console.error('Error handling request:', error);

      // Send generic error to client (don't expose internal details)
      this.sendError(res, 500, 'Internal server error');
    }
  }

  /**
   * Handle GET /v1/ - Ledger info
   */
  private async handleLedgerInfo(res: http.ServerResponse): Promise<void> {
    const metadata = this.forkManager.getMetadata();

    const ledgerInfo = {
      chain_id: metadata.chainId,
      epoch: metadata.epoch,
      ledger_version: metadata.ledgerVersion,
      oldest_ledger_version: "0",
      ledger_timestamp: metadata.timestamp,
      node_role: "full_node",
      oldest_block_height: "0",
      block_height: metadata.blockHeight,
      git_hash: "movehat-fork"
    };

    this.sendJSON(res, 200, ledgerInfo, {
      'x-aptos-chain-id': String(metadata.chainId),
      'x-aptos-ledger-version': metadata.ledgerVersion,
      'x-aptos-ledger-oldest-version': '0',
      'x-aptos-ledger-timestampusec': metadata.timestamp,
      'x-aptos-epoch': metadata.epoch,
      'x-aptos-block-height': metadata.blockHeight,
      'x-aptos-oldest-block-height': '0'
    });
  }

  /**
   * Handle GET /v1/accounts/:address
   */
  private async handleGetAccount(
    address: string,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const account = await this.forkManager.getAccount(address);

      this.sendJSON(res, 200, {
        sequence_number: account.sequenceNumber,
        authentication_key: account.authenticationKey
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found')) {
        this.send404(res, `Account not found: ${address}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Handle GET /v1/accounts/:address/resource/:resourceType
   */
  private async handleGetResource(
    address: string,
    resourceType: string,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const resource = await this.forkManager.getResource(address, resourceType);

      this.sendJSON(res, 200, {
        type: resourceType,
        data: resource
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found')) {
        this.send404(res, `Resource not found: ${resourceType}`, 'resource_not_found');
      } else {
        throw error;
      }
    }
  }

  /**
   * Handle GET /v1/accounts/:address/resources
   */
  private async handleGetResources(
    address: string,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const resources = await this.forkManager.getAllResources(address);

      // Convert to array format expected by the Movement L1 API
      const resourcesArray = Object.entries(resources).map(([type, data]) => ({
        type,
        data
      }));

      this.sendJSON(res, 200, resourcesArray);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found')) {
        this.send404(res, `Account not found: ${address}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Send JSON response.
   * unknown: arbitrary JSON-serializable payload; structural shape varies by
   * endpoint (account metadata, resource arrays, error envelopes).
   */
  private sendJSON(
    res: http.ServerResponse,
    status: number,
    data: unknown,
    extraHeaders: Record<string, string> = {}
  ): void {
    const body = JSON.stringify(data, null, 2);

    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...extraHeaders
    });

    res.end(body);
  }

  /**
   * Send 404 error
   */
  private send404(res: http.ServerResponse, message: string, errorCode: string = 'account_not_found'): void {
    this.sendJSON(res, 404, {
      message,
      error_code: errorCode,
      vm_error_code: null
    });
  }

  /**
   * Send error response
   */
  private sendError(res: http.ServerResponse, status: number, message: string): void {
    this.sendJSON(res, status, {
      message,
      error_code: 'internal_error',
      vm_error_code: null
    });
  }
}
