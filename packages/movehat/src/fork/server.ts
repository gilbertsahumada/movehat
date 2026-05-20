import http from 'http';
import { URL } from 'url';
import { ForkManager } from './manager.js';
import { logger } from '../ui/index.js';

export interface ForkServerOptions {
  /**
   * Origins allowed to make cross-origin requests. When unset (default),
   * no `Access-Control-Allow-Origin` header is emitted — any browser
   * cross-origin read is rejected by the user agent. Setting this to a
   * non-empty list opts into echoing matching `Origin` request headers
   * back. Wildcard `'*'` is intentionally NOT supported: cached fork
   * state may include resources that should not be readable by every
   * page in the dev's browser.
   */
  corsAllowOrigins?: readonly string[];
}

/**
 * Fork Server - Serves fork data via Movement L1 RPC API
 * Emulates a Movement L1 node using local fork storage
 */
export class ForkServer {
  private server: http.Server | null = null;
  private forkManager: ForkManager;
  private port: number;
  private host: string;
  private readonly corsAllowOrigins: ReadonlySet<string>;

  /**
   * @param host Interface to bind. Defaults to `127.0.0.1` so cached fork
   *   state (which may include sensitive resources) is not exposed on the LAN.
   *   Pass `'0.0.0.0'` only if you intentionally need to expose the server.
   * @param options Optional CORS allowlist (see {@link ForkServerOptions}).
   */
  constructor(
    forkPath: string,
    port: number = 8080,
    host: string = '127.0.0.1',
    options: ForkServerOptions = {}
  ) {
    this.forkManager = new ForkManager(forkPath);
    this.port = port;
    this.host = host;
    this.corsAllowOrigins = new Set(options.corsAllowOrigins ?? []);
  }

  /**
   * Set CORS headers for a request when the request's `Origin` is in
   * the allowlist. No-op otherwise.
   */
  private applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && this.corsAllowOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
  }

  /**
   * Start the fork server
   */
  async start(): Promise<void> {
    // Load fork metadata
    this.forkManager.load();
    const metadata = this.forkManager.getMetadata();

    logger.newline();
    logger.phase("Fork Server");
    logger.kv("Network", metadata.network, 2);
    logger.kv("Chain ID", String(metadata.chainId), 2);
    logger.kv("Ledger Version", String(metadata.ledgerVersion), 2);
    logger.kv("Forked at", metadata.createdAt, 2);

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        // Log full error server-side for diagnostics
        logger.error(`Error handling request: ${error instanceof Error ? error.message : String(error)}`);

        // Only send response if headers haven't been sent yet
        if (!res.headersSent) {
          this.applyCors(req, res);

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
        logger.newline();
        logger.success(`Fork Server listening on http://${displayHost}:${this.port}`);
        logger.kv("Bound interface", this.host, 2);
        logger.kv("Ledger Info", `http://${displayHost}:${this.port}/v1/`, 2);
        if (this.host === '0.0.0.0') {
          logger.warning("Server is bound to 0.0.0.0 — fork state is reachable from the LAN.", 2);
        }
        logger.newline();
        logger.info("Press Ctrl+C to stop");
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
          logger.newline();
          logger.success("Fork Server stopped");
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

    // Log request — plain so the fork-server access log retains its
    // grep-friendly line shape (timestamp + method + path, no symbol).
    logger.plain(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

    this.applyCors(req, res);

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
      } else if (pathname === '/v1/view' && req.method === 'POST') {
        await this.handleViewProxy(req, res);
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
      logger.error(`Error handling request: ${error instanceof Error ? error.message : String(error)}`);

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
   * Handle POST /v1/view — proxy to upstream RPC.
   *
   * Stateless: view results are not cached. Buffers the request body
   * with a 1 MiB ceiling, parses JSON, delegates to
   * `forkManager.forwardView`, and returns the upstream array verbatim.
   *
   * Errors map to:
   *   413 — body exceeds MAX_VIEW_BODY_BYTES
   *   400 — body is not valid JSON
   *   502 — upstream RPC failed (timeout, network error, non-200 response)
   */
  private async handleViewProxy(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const MAX_VIEW_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

    let body: string;
    try {
      body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        req.on('data', (chunk: Buffer | string) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buf.length;
          if (totalBytes > MAX_VIEW_BODY_BYTES) {
            reject(new Error('body_too_large'));
            req.destroy();
            return;
          }
          chunks.push(buf);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', (err) => reject(err));
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'body_too_large') {
        this.sendJSON(res, 413, {
          message: `Request body exceeds ${MAX_VIEW_BODY_BYTES} bytes`,
          error_code: 'body_too_large',
          vm_error_code: null
        });
        return;
      }
      throw error;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      this.sendJSON(res, 400, {
        message: 'Request body is not valid JSON',
        error_code: 'invalid_body',
        vm_error_code: null
      });
      return;
    }

    // Forward a narrow set of client headers to upstream so that
    // BCS-encoded responses (`Accept: application/x-bcs`) and client
    // identification (`X-Aptos-Client`) round-trip through the proxy.
    // Hop-by-hop and connection-level headers (host, connection,
    // content-length, etc.) are deliberately not forwarded.
    const forwardableHeaders: Record<string, string> = {};
    for (const name of ['accept', 'x-aptos-client'] as const) {
      const value = req.headers[name];
      if (typeof value === 'string') {
        // Use the canonical capitalization upstream expects.
        const canonical = name === 'accept' ? 'Accept' : 'X-Aptos-Client';
        forwardableHeaders[canonical] = value;
      }
    }

    try {
      const result = await this.forkManager.forwardView(payload, forwardableHeaders);
      this.sendJSON(res, 200, result);
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      // Sanitize: reuse the existing log-injection guard from
      // sanitizePathname (control chars, length cap).
      const safeMsg = this.sanitizePathname(rawMsg);
      logger.error(`Upstream view-fn call failed: ${rawMsg}`);
      this.sendJSON(res, 502, {
        message: `Upstream view-fn call failed: ${safeMsg}`,
        error_code: 'upstream_error',
        vm_error_code: null
      });
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
