import { createHash } from 'node:crypto';
import { MovementApiClient } from './api.js';
import { ForkStorage } from './storage.js';
import type { ForkMetadata, AccountState, CoinStore } from '../types/fork.js';
import { normalizeAddress } from '../utils/address.js';
import { logger } from '../ui/index.js';
import { assertCoinStore } from './validation.js';
import {
  ForkDataNotFoundError,
  ForkSnapshotPrunedError,
  FORK_SNAPSHOT_PRUNED_GUIDANCE,
  MovementApiError,
  isMovementApiHttpError,
  isPrunedSnapshotError,
} from './errors.js';
import { withFileLock, withFileLocks } from '../utils/fileLock.js';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export interface ForkInitializeOptions {
  overwrite?: boolean;
}

/**
 * Derive a deterministic 32-byte hex placeholder for the `authentication_key`
 * of a fork-funded account. The real auth_key is `sha3_256(public_key || 0x00)`
 * for Ed25519; the fork has no public key material, so we hash the address
 * itself. This is NOT a real auth key — downstream code must not treat it as
 * trustworthy key material. Distinguishable from the address by construction
 * (#63 — prior code used `address.padEnd(66, '0')` which was a no-op since
 * normalized addresses are already 66 chars).
 */
function forkAuthKeyPlaceholder(normalizedAddress: string): string {
  const stripped = normalizedAddress.startsWith('0x') ? normalizedAddress.slice(2) : normalizedAddress;
  const digest = createHash('sha3-256').update(stripped, 'hex').digest('hex');
  return `0x${digest}`;
}

function canonicalForkPath(forkPath: string): string {
  let existing = resolve(forkPath);
  const suffix: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    suffix.unshift(basename(existing));
    existing = parent;
  }
  return resolve(realpathSync(existing), ...suffix);
}

/**
 * Manager for fork operations
 * Orchestrates API client and storage
 */
export class ForkManager {
  private readonly forkPath: string;
  private storage: ForkStorage;
  private apiClient: MovementApiClient | null = null;
  private metadata: ForkMetadata | null = null;
  private cacheGeneration: string | null = null;

  /**
   * Optional API key sent as `Authorization: Bearer <key>` on every
   * outgoing Movement API request. Not persisted to disk via
   * {@link ForkMetadata} (keys stay in process memory). For the
   * load-then-set pattern, call `setApiKey()` after `load()`.
   */
  private apiKey?: string;

  constructor(forkPath: string) {
    this.forkPath = canonicalForkPath(forkPath);
    this.storage = new ForkStorage(this.forkPath);
  }

  private accountLockKey(): string {
    return `fork:${this.forkPath}:accounts`;
  }

  private resourceLockKey(): string {
    return `fork:${this.forkPath}:resources`;
  }

  private expectedCacheGeneration(): string {
    if (this.cacheGeneration === null) {
      this.cacheGeneration = this.storage.getCacheGeneration();
    }
    return this.cacheGeneration;
  }

  private translateReadError(error: unknown, notFoundMessage: string): never {
    if (isPrunedSnapshotError(error)) {
      throw new ForkSnapshotPrunedError(
        `Fork snapshot at ledger version ${this.getMetadata().ledgerVersion} is no longer available upstream. ${FORK_SNAPSHOT_PRUNED_GUIDANCE}`,
        { cause: error }
      );
    }
    if (isMovementApiHttpError(error, 404)) {
      throw new ForkDataNotFoundError(notFoundMessage, { cause: error });
    }
    throw error;
  }

  /**
   * Set or update the API key used for upstream Movement API requests.
   * Reconstructs the internal `MovementApiClient` if one exists.
   */
  setApiKey(apiKey: string | undefined): void {
    if (apiKey === undefined) {
      delete this.apiKey;
    } else {
      this.apiKey = apiKey;
    }
    if (this.apiClient && this.metadata) {
      this.apiClient = new MovementApiClient(this.metadata.nodeUrl, this.apiKey);
    }
  }

  /**
   * Initialize a new fork from a network.
   *
   * @param nodeUrl - Upstream JSON-RPC base URL.
   * @param networkName - Logical network label (defaults to `'custom'`).
   * @param apiKey - Optional API key for `Authorization: Bearer` header.
   */
  async initialize(
    nodeUrl: string,
    networkName: string = 'custom',
    apiKey?: string,
    options: ForkInitializeOptions = {}
  ): Promise<void> {
    if (apiKey === undefined) {
      delete this.apiKey;
    } else {
      this.apiKey = apiKey;
    }

    const apiClient = new MovementApiClient(nodeUrl, this.apiKey);
    const ledgerInfo = await apiClient.getLedgerInfo();

    const metadata: ForkMetadata = {
      network: networkName,
      nodeUrl,
      chainId: ledgerInfo.chain_id,
      ledgerVersion: ledgerInfo.ledger_version,
      timestamp: ledgerInfo.ledger_timestamp,
      epoch: ledgerInfo.epoch,
      blockHeight: ledgerInfo.block_height,
      createdAt: new Date().toISOString(),
    };

    const cacheGeneration = await withFileLocks(
      [this.accountLockKey(), this.resourceLockKey()],
      async () => {
        const existing = this.storage.exists();
        this.storage.initialize();
        if (options.overwrite) {
          const generation = this.storage.advanceCacheGeneration();
          this.storage.clearAccounts();
          this.storage.clearResources();
          this.storage.saveMetadata(metadata);
          return generation;
        }
        if (existing) {
          // 0.6.0 contract: re-initializing an existing fork refreshes its
          // snapshot metadata and keeps cached state (the documented mocha
          // before-hook pattern re-initializes on every run).
          logger.info(
            `Fork already exists at ${this.forkPath}; refreshing snapshot metadata ` +
              `(pass overwrite: true to reset cached state)`
          );
          this.storage.migrateLegacyResourceCache();
        }
        this.storage.saveMetadata(metadata);
        return this.storage.getCacheGeneration();
      }
    );
    this.metadata = metadata;
    this.apiClient = apiClient;
    this.cacheGeneration = cacheGeneration;

    logger.success(`Fork initialized at ledger version ${ledgerInfo.ledger_version}`);
  }

  /**
   * Load an existing fork. The API key is NOT persisted to disk —
   * callers needing authenticated upstream reads after `load()` must
   * call `setApiKey()` explicitly.
   */
  load(): void {
    if (!this.storage.exists()) {
      throw new Error('Fork does not exist. Run `initialize()` first.');
    }

    this.metadata = this.storage.loadMetadata();
    this.storage.migrateLegacyResourceCache();
    this.cacheGeneration = this.storage.getCacheGeneration();
    try {
      this.apiClient = new MovementApiClient(this.metadata.nodeUrl, this.apiKey);
    } catch (error) {
      if (error instanceof MovementApiError) {
        throw new MovementApiError(
          `${error.message}. This fork's metadata.json predates the credential ` +
            `rules — edit ${this.forkPath}/metadata.json to remove credentials from ` +
            `nodeUrl (pass an API key via setApiKey instead), or recreate the fork.`,
          error.code,
          { cause: error }
        );
      }
      throw error;
    }
  }

  getMetadata(): ForkMetadata {
    if (!this.metadata) {
      this.metadata = this.storage.loadMetadata();
    }
    return this.metadata;
  }

  async getAccount(address: string): Promise<AccountState> {
    const normalizedAddress = normalizeAddress(address);

    let accountState = this.storage.getAccount(normalizedAddress);

    if (!accountState) {
      if (!this.apiClient) {
        throw new Error('Fork not initialized. Call initialize() or load() first.');
      }
      const expectedGeneration = this.expectedCacheGeneration();

      logger.info(`Fetching account ${normalizedAddress} from network...`, 2);
      let accountData;
      try {
        accountData = await this.apiClient.getAccount(
          normalizedAddress,
          this.getMetadata().ledgerVersion
        );
      } catch (error) {
        this.translateReadError(error, `Account not found: ${normalizedAddress}`);
      }

      accountState = {
        sequenceNumber: accountData.sequence_number,
        authenticationKey: accountData.authentication_key,
      };

      accountState = await withFileLock(this.accountLockKey(), async () => {
        if (this.storage.getCacheGeneration() !== expectedGeneration) {
          return accountState!;
        }
        const cached = this.storage.getAccount(normalizedAddress);
        if (cached) return cached;
        this.storage.saveAccount(normalizedAddress, accountState!);
        logger.success(`Cached account ${normalizedAddress}`, 2);
        return accountState!;
      });
    }

    return accountState;
  }

  async getResource(address: string, resourceType: string): Promise<unknown> {
    const normalizedAddress = normalizeAddress(address);

    if (this.storage.hasResource(normalizedAddress, resourceType)) {
      return this.storage.getResource(normalizedAddress, resourceType);
    }
    let resource: unknown;
    {
      if (!this.apiClient) {
        throw new Error('Fork not initialized. Call initialize() or load() first.');
      }
      const expectedGeneration = this.expectedCacheGeneration();

      logger.info(`Fetching resource ${resourceType} for ${normalizedAddress}...`, 2);

      try {
        const resourceData = await this.apiClient.getAccountResource(
          normalizedAddress,
          resourceType,
          this.getMetadata().ledgerVersion
        );
        resource = resourceData.data;
        resource = await withFileLock(this.resourceLockKey(), async () => {
          if (this.storage.getCacheGeneration() !== expectedGeneration) {
            return resource;
          }
          if (this.storage.hasResource(normalizedAddress, resourceType)) {
            return this.storage.getResource(normalizedAddress, resourceType);
          }
          this.storage.saveResource(normalizedAddress, resourceType, resource);
          logger.success(`Cached resource ${resourceType}`, 2);
          return resource;
        });
      } catch (error) {
        this.translateReadError(
          error,
          `Resource ${resourceType} not found for account ${normalizedAddress}`
        );
      }
    }

    return resource;
  }

  async getAllResources(address: string): Promise<Record<string, unknown>> {
    const normalizedAddress = normalizeAddress(address);

    let resources = this.storage.getAllResources(normalizedAddress);

    if (!this.storage.hasAllResources(normalizedAddress)) {
      if (!this.apiClient) {
        throw new Error('Fork not initialized. Call initialize() or load() first.');
      }
      const expectedGeneration = this.expectedCacheGeneration();

      logger.info(`Fetching all resources for ${normalizedAddress}...`, 2);
      let resourcesList;
      try {
        resourcesList = await this.apiClient.getAccountResources(
          normalizedAddress,
          this.getMetadata().ledgerVersion
        );
      } catch (error) {
        this.translateReadError(error, `Account not found: ${normalizedAddress}`);
      }

      resources = Object.create(null) as Record<string, unknown>;
      for (const resource of resourcesList) {
        resources[resource.type] = resource.data;
      }

      resources = await withFileLock(this.resourceLockKey(), async () => {
        if (this.storage.getCacheGeneration() !== expectedGeneration) {
          return resources;
        }
        if (this.storage.hasAllResources(normalizedAddress)) {
          return this.storage.getAllResources(normalizedAddress);
        }
        const merged = { ...resources, ...this.storage.getAllResources(normalizedAddress) };
        this.storage.saveAllResources(normalizedAddress, merged);
        logger.success(`Cached ${Object.keys(merged).length} resources`, 2);
        return merged;
      });
    }

    return resources;
  }

  /**
   * Proxy of `POST /v1/view` to the upstream RPC, pinned to the fork's
   * recorded ledger version so results reflect the snapshot, not the
   * upstream's current state.
   *
   * View results are not cached — they depend on arguments, so any
   * caching layer would need argument-aware invalidation that the fork
   * system does not implement today. The response must be a JSON array;
   * BCS responses are rejected at the server layer with 406.
   *
   * `extraHeaders` forwards a narrow set of client headers upstream
   * (e.g. `X-Aptos-Client`).
   */
  async forwardView(
    payload: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<unknown[]> {
    if (!this.apiClient) {
      throw new Error('Fork not initialized. Call initialize() or load() first.');
    }
    try {
      return await this.apiClient.view(
        payload,
        extraHeaders,
        this.getMetadata().ledgerVersion
      );
    } catch (error) {
      if (isPrunedSnapshotError(error)) {
        throw new ForkSnapshotPrunedError(
          `Fork snapshot at ledger version ${this.getMetadata().ledgerVersion} is no longer available upstream. ${FORK_SNAPSHOT_PRUNED_GUIDANCE}`,
          { cause: error }
        );
      }
      throw error;
    }
  }

  async setResource(address: string, resourceType: string, data: unknown): Promise<void> {
    const normalizedAddress = normalizeAddress(address);
    await withFileLock(this.resourceLockKey(), async () => {
      this.storage.saveResource(normalizedAddress, resourceType, data);
    });
    logger.success(`Updated resource ${resourceType} for ${normalizedAddress}`, 2);
  }

  /** Adds to the existing balance rather than replacing it. */
  async fundAccount(address: string, amount: number, coinType: string = '0x1::aptos_coin::AptosCoin'): Promise<void> {
    // Integral values above MAX_SAFE_INTEGER (e.g. defaultBalance: 1e16) are
    // accepted as on 0.6.0; BigInt(amount) converts them exactly.
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError('amount must be a non-negative integer');
    }
    const normalizedAddress = normalizeAddress(address);
    const resourceType = `0x1::coin::CoinStore<${coinType}>`;

    let fetched: CoinStore | null = null;
    try {
      fetched = assertCoinStore(await this.getResource(normalizedAddress, resourceType));
    } catch (error) {
      if (!(error instanceof ForkDataNotFoundError)) throw error;
    }

    await withFileLocks(
      [this.accountLockKey(), this.resourceLockKey()],
      async () => {
        const cached = this.storage.hasResource(normalizedAddress, resourceType)
          ? this.storage.getResource(normalizedAddress, resourceType)
          : null;
        const coinStore: CoinStore = cached !== null
          ? assertCoinStore(cached)
          : fetched ?? {
              coin: { value: '0' },
              deposit_events: {
                counter: '0',
                guid: { id: { addr: normalizedAddress, creation_num: '0' } },
              },
              withdraw_events: {
                counter: '0',
                guid: { id: { addr: normalizedAddress, creation_num: '1' } },
              },
              frozen: false,
            };
        coinStore.coin.value = (BigInt(coinStore.coin.value) + BigInt(amount)).toString();
        this.storage.saveResource(normalizedAddress, resourceType, coinStore);
        if (!this.storage.getAccount(normalizedAddress)) {
          this.storage.saveAccount(normalizedAddress, {
            sequenceNumber: '0',
            authenticationKey: forkAuthKeyPlaceholder(normalizedAddress),
          });
        }
      }
    );

    logger.success(`Funded ${normalizedAddress} with ${amount} coins`, 2);
  }

  listAccounts(): string[] {
    return this.storage.listAccounts();
  }

  /**
   * Fund multiple accounts at once (batch operation)
   *
   * @param addresses Array of addresses to fund
   * @param amount Amount of coins per account
   * @param coinType Coin type (defaults to the chain's native coin)
   *
   * @example
   * await forkManager.fundMultipleAccounts(
   *   ["0x123...", "0x456..."],
   *   100_000_000 // 1 MOVE
   * );
   */
  async fundMultipleAccounts(
    addresses: string[],
    amount: number,
    coinType: string = '0x1::aptos_coin::AptosCoin'
  ): Promise<void> {
    logger.newline();
    logger.step(`Funding ${addresses.length} accounts with ${amount} coins each...`);

    for (const address of addresses) {
      await this.fundAccount(address, amount, coinType);
    }

    logger.success("All accounts funded successfully");
    logger.newline();
  }

  /**
   * Reset fork state to initial snapshot
   * Clears all cached accounts and resources, keeping only metadata
   *
   * @example
   * await forkManager.resetState();
   */
  async resetState(): Promise<void> {
    logger.newline();
    logger.step("Resetting fork state...");

    const generation = await withFileLocks(
      [this.accountLockKey(), this.resourceLockKey()],
      async () => {
        const nextGeneration = this.storage.advanceCacheGeneration();
        this.storage.clearAccounts();
        this.storage.clearResources();
        return nextGeneration;
      }
    );
    this.cacheGeneration = generation;

    logger.success("Fork state reset to initial snapshot");
    logger.newline();
  }

  /**
   * Get or create an account, ensuring it exists in the fork
   * If the account doesn't exist on-chain, creates a minimal account structure
   *
   * @param address The address to get or create
   * @returns AccountState for the address
   *
   * @example
   * const account = await forkManager.getOrCreateAccount("0x123...");
   */
  async getOrCreateAccount(address: string): Promise<AccountState> {
    const normalizedAddress = normalizeAddress(address);

    try {
      return await this.getAccount(normalizedAddress);
    } catch (error) {
      if (!(error instanceof ForkDataNotFoundError)) throw error;
      const newAccount: AccountState = {
        sequenceNumber: '0',
        authenticationKey: forkAuthKeyPlaceholder(normalizedAddress),
      };

      const account = await withFileLock(this.accountLockKey(), async () => {
        const cached = this.storage.getAccount(normalizedAddress);
        if (cached) return cached;
        this.storage.saveAccount(normalizedAddress, newAccount);
        return newAccount;
      });
      logger.success(`Created new account ${normalizedAddress}`, 2);

      return account;
    }
  }
}
