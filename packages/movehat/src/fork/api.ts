import https from 'https';
import http from 'http';
import { URL } from 'url';
import type { LedgerInfo, AccountData, AccountResource } from '../types/fork.js';
import { normalizeAddressShort } from '../utils/address.js';

export interface MovementApiClientOptions {
  /** Abort the request after this many ms (default: 30_000). */
  timeoutMs?: number;
  /** Reject responses larger than this many bytes (default: 16 MiB). */
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Client for interacting with Movement L1 JSON API.
 *
 * When constructed with an `apiKey`, every outgoing request carries
 * an `Authorization: Bearer <apiKey>` header. Use this for rate-
 * limited public endpoints (e.g. Movement testnet under load) or
 * auth-gated nodes.
 */
export class MovementApiClient {
  private nodeUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(
    nodeUrl: string,
    apiKey?: string,
    options: MovementApiClientOptions = {}
  ) {
    // Remove trailing slash
    let normalized = nodeUrl.replace(/\/$/, '');

    // If URL already ends with /v1, use as is
    // Otherwise, assume it's the base URL
    if (!normalized.endsWith('/v1')) {
      // Base URL without /v1, we'll add it in requests
    }

    this.nodeUrl = normalized;
    if (apiKey !== undefined) this.apiKey = apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  /**
   * Make a GET request to the API.
   *
   * Adds `Authorization: Bearer <apiKey>` when the client was
   * constructed with an `apiKey`. The header is omitted otherwise
   * to preserve backwards-compatible behavior for unauthenticated
   * public endpoints.
   */
  private async get<T>(path: string): Promise<T> {
    const fullUrl = `${this.nodeUrl}${path}`;
    const parsedUrl = new URL(fullUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestOptions: {
      method: 'GET';
      headers?: Record<string, string>;
    } = { method: 'GET' };
    if (this.apiKey !== undefined) {
      requestOptions.headers = { Authorization: `Bearer ${this.apiKey}` };
    }

    const timeoutMs = this.timeoutMs;
    const maxBytes = this.maxBytes;

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const req = client.get(fullUrl, requestOptions, (res) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on('data', (chunk: Buffer | string) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buf.length;
          if (totalBytes > maxBytes) {
            req.destroy();
            settle(() =>
              reject(
                new Error(
                  `Response exceeded maxBytes (${maxBytes}); ${totalBytes} bytes received before abort`
                )
              )
            );
            return;
          }
          chunks.push(buf);
        });

        res.on('end', () => {
          if (settled) return;
          const data = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            settle(() =>
              reject(
                new Error(
                  `API request failed with status ${res.statusCode}: ${data}`
                )
              )
            );
            return;
          }

          try {
            const parsed = JSON.parse(data);
            settle(() => resolve(parsed));
          } catch (err) {
            settle(() =>
              reject(new Error(`Failed to parse JSON response: ${err}`))
            );
          }
        });
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy();
        settle(() =>
          reject(new Error(`API request timed out after ${timeoutMs}ms`))
        );
      });

      req.on('error', (err) => {
        settle(() => reject(new Error(`API request failed: ${err.message}`)));
      });

      req.end();
    });
  }

  /**
   * Build API path with proper prefix
   */
  private apiPath(suffix: string): string {
    // If nodeUrl already ends with /v1, just add the suffix
    // Otherwise add /v1 prefix
    return this.nodeUrl.endsWith('/v1') ? suffix : `/v1${suffix}`;
  }

  /**
   * Get ledger information
   */
  async getLedgerInfo(): Promise<LedgerInfo> {
    return this.get<LedgerInfo>(this.apiPath('/'));
  }

  /**
   * Get account information
   */
  async getAccount(address: string): Promise<AccountData> {
    const normalizedAddress = normalizeAddressShort(address);

    return this.get<AccountData>(this.apiPath(`/accounts/${normalizedAddress}`));
  }

  /**
   * Get a specific account resource
   */
  async getAccountResource(address: string, resourceType: string): Promise<any> {
    const normalizedAddress = normalizeAddressShort(address);

    // URL encode the resource type
    const encodedType = encodeURIComponent(resourceType);

    return this.get<any>(this.apiPath(`/accounts/${normalizedAddress}/resource/${encodedType}`));
  }

  /**
   * Get all resources for an account
   */
  async getAccountResources(address: string): Promise<AccountResource[]> {
    const normalizedAddress = normalizeAddressShort(address);

    return this.get<AccountResource[]>(this.apiPath(`/accounts/${normalizedAddress}/resources`));
  }
}
