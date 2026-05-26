import https from 'https';
import http from 'http';
import { URL } from 'url';
import type { LedgerInfo, AccountData, AccountResource } from '../types/fork.js';
import { normalizeAddressShort } from '../utils/address.js';
import {
  assertLedgerInfo,
  assertAccountData,
  assertAccountResource,
  assertAccountResourceArray,
} from './validation.js';

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
   * Make a POST request to the API with a JSON body.
   *
   * Mirrors `get<T>` for TLS/timeout/maxBytes/error-wrapping; differs
   * only in `method: 'POST'`, the `Content-Type: application/json`
   * header, and writing `body` to the request stream before `end()`.
   *
   * `extraHeaders` are merged in last and override defaults — used by
   * the fork-server view proxy to forward client headers like
   * `Accept` or `X-Aptos-Client` through to the upstream node.
   */
  private async post<T>(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<T> {
    const fullUrl = `${this.nodeUrl}${path}`;
    const parsedUrl = new URL(fullUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const payload = JSON.stringify(body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload).toString(),
    };
    if (this.apiKey !== undefined) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    for (const [k, v] of Object.entries(extraHeaders)) {
      // Don't let callers override Content-Length — we just computed it.
      if (k.toLowerCase() === 'content-length') continue;
      headers[k] = v;
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

      const req = client.request(fullUrl, { method: 'POST', headers }, (res) => {
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

      req.write(payload);
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
    const raw = await this.get<unknown>(this.apiPath('/'));
    return assertLedgerInfo(raw);
  }

  /**
   * Get account information
   */
  async getAccount(address: string): Promise<AccountData> {
    const normalizedAddress = normalizeAddressShort(address);

    const raw = await this.get<unknown>(this.apiPath(`/accounts/${normalizedAddress}`));
    return assertAccountData(raw);
  }

  /**
   * Get a specific account resource
   */
  async getAccountResource(address: string, resourceType: string): Promise<AccountResource> {
    const normalizedAddress = normalizeAddressShort(address);

    // URL encode the resource type
    const encodedType = encodeURIComponent(resourceType);

    const raw = await this.get<unknown>(this.apiPath(`/accounts/${normalizedAddress}/resource/${encodedType}`));
    return assertAccountResource(raw);
  }

  /**
   * Get all resources for an account
   */
  async getAccountResources(address: string): Promise<AccountResource[]> {
    const normalizedAddress = normalizeAddressShort(address);

    const raw = await this.get<unknown>(this.apiPath(`/accounts/${normalizedAddress}/resources`));
    return assertAccountResourceArray(raw);
  }

  /**
   * Execute a Move view function via the upstream node's POST /v1/view.
   *
   * Stateless passthrough — view results are not cached. Returns the raw
   * array the upstream API returns (single-value views still come back as
   * a one-element tuple).
   *
   * `extraHeaders` are forwarded to upstream — used by the fork server's
   * view proxy to relay client headers (`Accept`, `X-Aptos-Client`, …)
   * so downstream behavior such as BCS-encoded responses is preserved.
   */
  async view(
    payload: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<unknown[]> {
    return this.post<unknown[]>(this.apiPath('/view'), payload, extraHeaders);
  }
}
