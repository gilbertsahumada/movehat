import https from 'https';
import http from 'http';
import { URL } from 'url';
import type { LedgerInfo, AccountData, AccountResource } from '../types/fork.js';
import { normalizeAddressShort } from '../utils/address.js';

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

  constructor(nodeUrl: string, apiKey?: string) {
    // Remove trailing slash
    let normalized = nodeUrl.replace(/\/$/, '');

    // If URL already ends with /v1, use as is
    // Otherwise, assume it's the base URL
    if (!normalized.endsWith('/v1')) {
      // Base URL without /v1, we'll add it in requests
    }

    this.nodeUrl = normalized;
    if (apiKey !== undefined) this.apiKey = apiKey;
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

    return new Promise((resolve, reject) => {
      const req = client.get(fullUrl, requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`API request failed with status ${res.statusCode}: ${data}`));
            return;
          }

          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (err) {
            reject(new Error(`Failed to parse JSON response: ${err}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`API request failed: ${err.message}`));
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
