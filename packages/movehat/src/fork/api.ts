import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import type { LedgerInfo, AccountData, AccountResource } from '../types/fork.js';
import { normalizeAddressShort } from '../utils/address.js';
import {
  assertLedgerInfo,
  assertAccountData,
  assertAccountResource,
  assertAccountResourceArray,
} from './validation.js';
import { MovementApiError } from './errors.js';

export interface MovementApiClientOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;

export class MovementApiClient {
  private readonly nodeUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(nodeUrl: string, apiKey?: string, options: MovementApiClientOptions = {}) {
    let parsed: URL;
    try {
      parsed = new URL(nodeUrl.replace(/\/$/, ''));
    } catch (cause) {
      throw new MovementApiError('Movement API URL is invalid', 'invalid_response', { cause });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new MovementApiError(
        `Unsupported Movement API protocol: ${parsed.protocol}`,
        'invalid_response'
      );
    }
    if (parsed.username !== '' || parsed.password !== '') {
      throw new MovementApiError(
        'Movement API URL must not contain embedded credentials',
        'invalid_response'
      );
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive safe integer');
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError('maxBytes must be a positive safe integer');
    }

    this.nodeUrl = parsed.toString().replace(/\/$/, '');
    if (apiKey !== undefined) this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(`${this.nodeUrl}${path}`);
    const client = url.protocol === 'https:' ? https : http;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {};
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    if (this.apiKey !== undefined) headers.Authorization = `Bearer ${this.apiKey}`;
    for (const [name, value] of Object.entries(extraHeaders)) {
      if (name.toLowerCase() !== 'content-length') headers[name] = value;
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        fn();
      };
      const req = client.request(url, { method, headers }, (res) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        const statusCode = res.statusCode ?? 0;
        const limit = statusCode === 200 ? this.maxBytes : Math.min(this.maxBytes, MAX_ERROR_BYTES);

        res.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.length;
          if (totalBytes > limit) {
            req.destroy();
            settle(() => reject(statusCode === 200
              ? new MovementApiError(
                  `Movement API response exceeded ${limit} bytes`,
                  'response_too_large'
                )
              : new MovementApiError(
                  `Movement API request failed with status ${statusCode}`,
                  'http_error',
                  { statusCode }
                )));
            return;
          }
          chunks.push(buffer);
        });
        res.on('end', () => {
          if (settled) return;
          const text = Buffer.concat(chunks).toString('utf8');
          if (statusCode !== 200) {
            let upstreamErrorCode: string | undefined;
            try {
              const value: unknown = JSON.parse(text);
              if (
                typeof value === 'object' && value !== null &&
                typeof (value as { error_code?: unknown }).error_code === 'string' &&
                /^[a-zA-Z0-9_.:-]{1,128}$/.test((value as { error_code: string }).error_code)
              ) {
                upstreamErrorCode = (value as { error_code: string }).error_code;
              }
            } catch {
              // Error bodies are untrusted diagnostics; never expose them.
            }
            settle(() => reject(new MovementApiError(
              `Movement API request failed with status ${statusCode}`,
              'http_error',
              { statusCode, ...(upstreamErrorCode === undefined ? {} : { upstreamErrorCode }) }
            )));
            return;
          }
          try {
            settle(() => resolve(JSON.parse(text) as T));
          } catch (cause) {
            settle(() => reject(new MovementApiError(
              'Movement API returned invalid JSON',
              'invalid_response',
              { cause }
            )));
          }
        });
        res.once('aborted', () => {
          settle(() => reject(new MovementApiError(
            'Movement API response was aborted',
            'network_error'
          )));
        });
        res.once('error', (cause) => {
          settle(() => reject(new MovementApiError(
            'Movement API response failed',
            'network_error',
            { cause }
          )));
        });
      });

      const deadline = setTimeout(() => {
        req.destroy();
        settle(() => reject(new MovementApiError(
          `Movement API request timed out after ${this.timeoutMs}ms`,
          'timeout'
        )));
      }, this.timeoutMs);

      // This is an absolute request deadline, not a socket-idle timeout.
      // A peer that trickles bytes must not keep a pinned fork read alive
      // indefinitely.
      req.on('error', (cause) => {
        settle(() => reject(new MovementApiError(
          'Movement API request failed',
          'network_error',
          { cause }
        )));
      });
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  private apiPath(suffix: string): string {
    return this.nodeUrl.endsWith('/v1') ? suffix : `/v1${suffix}`;
  }

  private atLedgerVersion(path: string, ledgerVersion?: string): string {
    if (ledgerVersion === undefined) return path;
    if (!/^\d+$/.test(ledgerVersion)) {
      throw new MovementApiError(
        'ledgerVersion must be an unsigned integer string',
        'invalid_response'
      );
    }
    return `${path}${path.includes('?') ? '&' : '?'}ledger_version=${encodeURIComponent(ledgerVersion)}`;
  }

  private validate<T>(raw: unknown, validator: (value: unknown) => T): T {
    try {
      return validator(raw);
    } catch (cause) {
      throw new MovementApiError(
        'Movement API response failed schema validation',
        'invalid_response',
        { cause }
      );
    }
  }

  async getLedgerInfo(): Promise<LedgerInfo> {
    return this.validate(
      await this.request<unknown>('GET', this.apiPath('/')),
      assertLedgerInfo
    );
  }

  async getAccount(address: string, ledgerVersion?: string): Promise<AccountData> {
    const normalized = normalizeAddressShort(address);
    return this.validate(
      await this.request<unknown>('GET', this.atLedgerVersion(
        this.apiPath(`/accounts/${normalized}`), ledgerVersion
      )),
      assertAccountData
    );
  }

  async getAccountResource(
    address: string,
    resourceType: string,
    ledgerVersion?: string
  ): Promise<AccountResource> {
    const normalized = normalizeAddressShort(address);
    const encodedType = encodeURIComponent(resourceType);
    return this.validate(
      await this.request<unknown>('GET', this.atLedgerVersion(
        this.apiPath(`/accounts/${normalized}/resource/${encodedType}`), ledgerVersion
      )),
      assertAccountResource
    );
  }

  async getAccountResources(address: string, ledgerVersion?: string): Promise<AccountResource[]> {
    const normalized = normalizeAddressShort(address);
    return this.validate(
      await this.request<unknown>('GET', this.atLedgerVersion(
        this.apiPath(`/accounts/${normalized}/resources`), ledgerVersion
      )),
      assertAccountResourceArray
    );
  }

  async view(
    payload: unknown,
    extraHeaders: Record<string, string> = {},
    ledgerVersion?: string
  ): Promise<unknown[]> {
    const raw = await this.request<unknown>(
      'POST',
      this.atLedgerVersion(this.apiPath('/view'), ledgerVersion),
      payload,
      extraHeaders
    );
    if (!Array.isArray(raw)) {
      throw new MovementApiError(
        'Movement API response failed schema validation',
        'invalid_response'
      );
    }
    return raw;
  }
}
