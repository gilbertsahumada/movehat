import https from 'https';
import http from 'http';
import { URL } from 'url';
import type { LedgerInfo, AccountData, AccountResource } from '../types/fork.js';

/**
 * Client for interacting with Movement/Aptos-compatible JSON API
 */
export class MovementApiClient {
  private nodeUrl: string;

  constructor(nodeUrl: string) {
    // Remove trailing slash
    let normalized = nodeUrl.replace(/\/$/, '');

    // If URL already ends with /v1, use as is
    // Otherwise, assume it's the base URL
    if (!normalized.endsWith('/v1')) {
      // Base URL without /v1, we'll add it in requests
    }

    this.nodeUrl = normalized;
  }

  /**
   * Make a GET request to the API
   */
  private async get<T>(path: string): Promise<T> {
    const fullUrl = `${this.nodeUrl}${path}`;
    const parsedUrl = new URL(fullUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const req = client.get(fullUrl, (res) => {
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
    // Normalize address (ensure 0x prefix and lowercase)
    const normalizedAddress = address.toLowerCase().startsWith('0x')
      ? address.toLowerCase()
      : `0x${address.toLowerCase()}`;

    return this.get<AccountData>(this.apiPath(`/accounts/${normalizedAddress}`));
  }

  /**
   * Get a specific account resource
   */
  async getAccountResource(address: string, resourceType: string): Promise<any> {
    const normalizedAddress = address.toLowerCase().startsWith('0x')
      ? address.toLowerCase()
      : `0x${address.toLowerCase()}`;

    // URL encode the resource type
    const encodedType = encodeURIComponent(resourceType);

    return this.get<any>(this.apiPath(`/accounts/${normalizedAddress}/resource/${encodedType}`));
  }

  /**
   * Get all resources for an account
   */
  async getAccountResources(address: string): Promise<AccountResource[]> {
    const normalizedAddress = address.toLowerCase().startsWith('0x')
      ? address.toLowerCase()
      : `0x${address.toLowerCase()}`;

    return this.get<AccountResource[]>(this.apiPath(`/accounts/${normalizedAddress}/resources`));
  }
}
