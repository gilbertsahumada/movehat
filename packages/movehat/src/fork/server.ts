import http from 'http';
import { URL } from 'url';
import { ForkManager } from './manager.js';

/**
 * Fork Server - Serves fork data via Movement/Aptos RPC API
 * Emulates a Movement L1 node using local fork storage
 */
export class ForkServer {
  private server: http.Server | null = null;
  private forkManager: ForkManager;
  private port: number;

  constructor(forkPath: string, port: number = 8080) {
    this.forkManager = new ForkManager(forkPath);
    this.port = port;
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
        console.error(`Error handling request:`, error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Internal server error',
          error: error.message
        }));
      });
    });

    return new Promise((resolve) => {
      this.server!.listen(this.port, () => {
        console.log(`\nFork Server listening on http://localhost:${this.port}`);
        console.log(`  Ledger Info: http://localhost:${this.port}/v1/`);
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
      } else if (pathname.match(/^\/v1\/accounts\/0x[a-fA-F0-9]+$/)) {
        const address = pathname.split('/').pop()!;
        await this.handleGetAccount(address, res);
      } else if (pathname.match(/^\/v1\/accounts\/0x[a-fA-F0-9]+\/resource\/.+$/)) {
        const parts = pathname.split('/');
        const accountIndex = parts.indexOf('accounts') + 1;
        const resourceIndex = parts.indexOf('resource') + 1;
        const address = parts[accountIndex];
        const resourceType = decodeURIComponent(parts.slice(resourceIndex).join('/'));
        await this.handleGetResource(address, resourceType, res);
      } else if (pathname.match(/^\/v1\/accounts\/0x[a-fA-F0-9]+\/resources$/)) {
        const address = pathname.split('/')[3];
        await this.handleGetResources(address, res);
      } else {
        this.send404(res, `Endpoint not found: ${pathname}`);
      }
    } catch (error: any) {
      this.sendError(res, 500, error.message);
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
    } catch (error: any) {
      if (error.message.includes('not found')) {
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
    } catch (error: any) {
      if (error.message.includes('not found')) {
        this.send404(res, `Resource not found: ${resourceType}`);
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

      // Convert to array format expected by Aptos API
      const resourcesArray = Object.entries(resources).map(([type, data]) => ({
        type,
        data
      }));

      this.sendJSON(res, 200, resourcesArray);
    } catch (error: any) {
      if (error.message.includes('not found')) {
        this.send404(res, `Account not found: ${address}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Send JSON response
   */
  private sendJSON(
    res: http.ServerResponse,
    status: number,
    data: any,
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
  private send404(res: http.ServerResponse, message: string): void {
    this.sendJSON(res, 404, {
      message,
      error_code: 'account_not_found',
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
