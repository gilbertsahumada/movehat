import { createHash } from 'node:crypto';
import { MovementApiClient } from './api.js';
import {
  beginCacheGenerationTransition,
  commitCacheGenerationTransition,
  ForkStorage,
  migrateLegacyResourceCacheAtGeneration,
} from './storage.js';
import type { ForkMetadata, AccountState, CoinStore } from '../types/fork.js';
import { normalizeAddress } from '../utils/address.js';
import { logger } from '../ui/index.js';
import { assertCoinStore } from './validation.js';
import {
  ForkCacheGenerationTransitionError,
  ForkDataNotFoundError,
  ForkSnapshotChangedError,
  ForkSnapshotPrunedError,
  FORK_SNAPSHOT_CHANGED_GUIDANCE,
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
      this.cacheGeneration = this.readCurrentCacheGeneration();
    }
    return this.cacheGeneration;
  }

  private snapshotChanged(cause?: unknown): never {
    throw new ForkSnapshotChangedError(
      FORK_SNAPSHOT_CHANGED_GUIDANCE,
      cause === undefined ? {} : { cause }
    );
  }

  private readCurrentCacheGeneration(): string {
    try {
      return this.storage.getCacheGeneration();
    } catch (error) {
      if (error instanceof ForkCacheGenerationTransitionError) {
        this.snapshotChanged(error);
      }
      throw error;
    }
  }

  private migrateLegacyResourceCache(expectedGeneration: string): void {
    try {
      migrateLegacyResourceCacheAtGeneration(this.forkPath, expectedGeneration);
    } catch (error) {
      if (error instanceof ForkCacheGenerationTransitionError) {
        this.snapshotChanged(error);
      }
      throw error;
    }
  }

  private assertCacheGeneration(expectedGeneration: string): void {
    if (this.readCurrentCacheGeneration() !== expectedGeneration) {
      this.snapshotChanged();
    }
  }

  /**
   * Optimistic, lock-free snapshot read. Generation transitions are published
   * before multi-file rotations and committed last, so matching checks around
   * an atomic JSON read establish a stable linearization point without adding a
   * cross-process lock to every cache hit.
   */
  private readAtGeneration<T>(expectedGeneration: string, read: () => T): T {
    try {
      this.assertCacheGeneration(expectedGeneration);
      const value = read();
      this.assertCacheGeneration(expectedGeneration);
      return value;
    } catch (error) {
      if (error instanceof ForkSnapshotChangedError) throw error;
      // Storage uses exists-then-read operations, while snapshot rotations
      // unlink cache files after publishing the transition marker. If that
      // race surfaces as ENOENT (or any other I/O error), re-check the
      // generation before preserving the original error so stale reads keep
      // the public ForkSnapshotChangedError contract.
      this.assertCacheGeneration(expectedGeneration);
      throw error;
    }
  }

  private metadataAtGeneration(expectedGeneration: string): ForkMetadata {
    return this.readAtGeneration(expectedGeneration, () => {
      if (!this.metadata) {
        this.metadata = this.storage.loadMetadata();
      }
      return this.metadata;
    });
  }

  private translateReadError(
    error: unknown,
    notFoundMessage: string,
    ledgerVersion: string
  ): never {
    if (isPrunedSnapshotError(error)) {
      throw new ForkSnapshotPrunedError(
        `Fork snapshot at ledger version ${ledgerVersion} is no longer available upstream. ${FORK_SNAPSHOT_PRUNED_GUIDANCE}`,
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

    // Contact upstream only when a fresh snapshot is actually needed: a
    // brand-new fork or an explicit overwrite. Re-initializing an existing
    // fork re-adopts its pinned snapshot, so it must work offline and must
    // not move the ledger out from under the cached resources.
    const existedBeforeLock = this.storage.exists();
    let freshMetadata: ForkMetadata | undefined;
    if (options.overwrite || !existedBeforeLock) {
      const ledgerInfo = await apiClient.getLedgerInfo();
      freshMetadata = {
        network: networkName,
        nodeUrl,
        chainId: ledgerInfo.chain_id,
        ledgerVersion: ledgerInfo.ledger_version,
        timestamp: ledgerInfo.ledger_timestamp,
        epoch: ledgerInfo.epoch,
        blockHeight: ledgerInfo.block_height,
        createdAt: new Date().toISOString(),
      };
    }

    const resolved = await withFileLocks(
      [this.accountLockKey(), this.resourceLockKey()],
      async (): Promise<{ metadata: ForkMetadata; generation: string }> => {
        const existing = this.storage.exists();

        if (options.overwrite) {
          this.storage.initialize();
          const generation = beginCacheGenerationTransition(this.forkPath);
          // Leave the transition marker in place if any mutation fails. A
          // subsequent explicit overwrite can recover safely; readers never
          // accept a partially-rotated snapshot as stable.
          this.storage.clearAccounts();
          this.storage.clearResources();
          this.storage.saveMetadata(freshMetadata!);
          commitCacheGenerationTransition(this.forkPath, generation);
          return { metadata: freshMetadata!, generation };
        }

        if (existing) {
          // 0.6.0 contract: re-initializing an existing fork re-adopts its
          // pinned snapshot and keeps cached state (the documented mocha
          // before-hook pattern re-initializes on every run). Run the 0.6
          // legacy-cache migration BEFORE storage.initialize() stamps the
          // migration marker — otherwise the marker makes the migration a
          // no-op and the per-address cache markers never get written.
          const generation = this.readCurrentCacheGeneration();
          this.migrateLegacyResourceCache(generation);
          this.assertCacheGeneration(generation);
          this.storage.initialize();
          const preserved = this.storage.loadMetadata();
          // Keep the pinned ledger identity so the cache stays consistent
          // with metadata; refresh only the connection labels from this
          // call's arguments.
          const readopted: ForkMetadata = { ...preserved, network: networkName, nodeUrl };
          this.storage.saveMetadata(readopted);
          logger.info(
            `Fork already exists at ${this.forkPath}; re-adopting pinned snapshot ` +
              `at ledger version ${preserved.ledgerVersion} (pass overwrite: true to reset cached state)`
          );
          return { metadata: readopted, generation };
        }

        // Brand-new fork. freshMetadata was built above unless a concurrent
        // process removed the fork between the pre-lock check and the lock.
        if (freshMetadata === undefined) {
          throw new Error(
            'Fork state changed during initialization (concurrently removed); retry initialize()'
          );
        }
        this.storage.initialize();
        this.storage.saveMetadata(freshMetadata);
        return { metadata: freshMetadata, generation: this.readCurrentCacheGeneration() };
      }
    );
    this.metadata = resolved.metadata;
    this.apiClient = apiClient;
    this.cacheGeneration = resolved.generation;

    logger.success(`Fork initialized at ledger version ${resolved.metadata.ledgerVersion}`);
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

    // Establish metadata and generation from one stable state. A concurrent
    // reset/overwrite publishes a transition marker before touching either, so
    // this fails closed instead of memoizing a mismatched pair.
    const generation = this.readCurrentCacheGeneration();
    this.migrateLegacyResourceCache(generation);
    const metadata = this.storage.loadMetadata();
    this.assertCacheGeneration(generation);
    this.metadata = metadata;
    this.cacheGeneration = generation;
    try {
      this.apiClient = new MovementApiClient(metadata.nodeUrl, this.apiKey);
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
    const expectedGeneration = this.expectedCacheGeneration();
    return this.metadataAtGeneration(expectedGeneration);
  }

  async getAccount(address: string): Promise<AccountState> {
    const normalizedAddress = normalizeAddress(address);
    const expectedGeneration = this.expectedCacheGeneration();

    let accountState = this.readAtGeneration(
      expectedGeneration,
      () => this.storage.getAccount(normalizedAddress)
    );

    if (!accountState) {
      if (!this.apiClient) {
        throw new Error('Fork not initialized. Call initialize() or load() first.');
      }
      const ledgerVersion = this.metadataAtGeneration(expectedGeneration).ledgerVersion;

      logger.info(`Fetching account ${normalizedAddress} from network...`, 2);
      let accountData;
      try {
        accountData = await this.apiClient.getAccount(
          normalizedAddress,
          ledgerVersion
        );
      } catch (error) {
        this.assertCacheGeneration(expectedGeneration);
        this.translateReadError(
          error,
          `Account not found: ${normalizedAddress}`,
          ledgerVersion
        );
      }

      accountState = {
        sequenceNumber: accountData.sequence_number,
        authenticationKey: accountData.authentication_key,
      };

      accountState = await withFileLock(this.accountLockKey(), async () => {
        this.assertCacheGeneration(expectedGeneration);
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
    const expectedGeneration = this.expectedCacheGeneration();

    const cachedResource = this.readAtGeneration(expectedGeneration, () => {
      if (!this.storage.hasResource(normalizedAddress, resourceType)) {
        return { found: false as const };
      }
      return {
        found: true as const,
        value: this.storage.getResource(normalizedAddress, resourceType),
      };
    });
    if (cachedResource.found) {
      return cachedResource.value;
    }
    let resource: unknown;
    {
      if (!this.apiClient) {
        throw new Error('Fork not initialized. Call initialize() or load() first.');
      }
      const ledgerVersion = this.metadataAtGeneration(expectedGeneration).ledgerVersion;

      logger.info(`Fetching resource ${resourceType} for ${normalizedAddress}...`, 2);

      try {
        const resourceData = await this.apiClient.getAccountResource(
          normalizedAddress,
          resourceType,
          ledgerVersion
        );
        resource = resourceData.data;
        resource = await withFileLock(this.resourceLockKey(), async () => {
          this.assertCacheGeneration(expectedGeneration);
          if (this.storage.hasResource(normalizedAddress, resourceType)) {
            return this.storage.getResource(normalizedAddress, resourceType);
          }
          this.storage.saveResource(normalizedAddress, resourceType, resource);
          logger.success(`Cached resource ${resourceType}`, 2);
          return resource;
        });
      } catch (error) {
        this.assertCacheGeneration(expectedGeneration);
        this.translateReadError(
          error,
          `Resource ${resourceType} not found for account ${normalizedAddress}`,
          ledgerVersion
        );
      }
    }

    return resource;
  }

  async getAllResources(address: string): Promise<Record<string, unknown>> {
    const normalizedAddress = normalizeAddress(address);
    const expectedGeneration = this.expectedCacheGeneration();

    const cachedResources = this.readAtGeneration(expectedGeneration, () => ({
      resources: this.storage.getAllResources(normalizedAddress),
      complete: this.storage.hasAllResources(normalizedAddress),
    }));
    let resources = cachedResources.resources;

    if (!cachedResources.complete) {
      if (!this.apiClient) {
        throw new Error('Fork not initialized. Call initialize() or load() first.');
      }
      const ledgerVersion = this.metadataAtGeneration(expectedGeneration).ledgerVersion;

      logger.info(`Fetching all resources for ${normalizedAddress}...`, 2);
      let resourcesList;
      try {
        resourcesList = await this.apiClient.getAccountResources(
          normalizedAddress,
          ledgerVersion
        );
      } catch (error) {
        this.assertCacheGeneration(expectedGeneration);
        this.translateReadError(
          error,
          `Account not found: ${normalizedAddress}`,
          ledgerVersion
        );
      }

      resources = Object.create(null) as Record<string, unknown>;
      for (const resource of resourcesList) {
        resources[resource.type] = resource.data;
      }

      resources = await withFileLock(this.resourceLockKey(), async () => {
        this.assertCacheGeneration(expectedGeneration);
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
    const expectedGeneration = this.expectedCacheGeneration();
    const ledgerVersion = this.metadataAtGeneration(expectedGeneration).ledgerVersion;
    try {
      const result = await this.apiClient.view(
        payload,
        extraHeaders,
        ledgerVersion
      );
      this.assertCacheGeneration(expectedGeneration);
      return result;
    } catch (error) {
      this.assertCacheGeneration(expectedGeneration);
      if (isPrunedSnapshotError(error)) {
        throw new ForkSnapshotPrunedError(
          `Fork snapshot at ledger version ${ledgerVersion} is no longer available upstream. ${FORK_SNAPSHOT_PRUNED_GUIDANCE}`,
          { cause: error }
        );
      }
      throw error;
    }
  }

  async setResource(address: string, resourceType: string, data: unknown): Promise<void> {
    const normalizedAddress = normalizeAddress(address);
    const expectedGeneration = this.expectedCacheGeneration();
    await withFileLock(this.resourceLockKey(), async () => {
      this.assertCacheGeneration(expectedGeneration);
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

    const expectedGeneration = this.expectedCacheGeneration();
    let fetched: CoinStore | null = null;
    try {
      fetched = assertCoinStore(await this.getResource(normalizedAddress, resourceType));
    } catch (error) {
      if (!(error instanceof ForkDataNotFoundError)) throw error;
    }

    await withFileLocks(
      [this.accountLockKey(), this.resourceLockKey()],
      async () => {
        // The pre-lock fetch may have observed the snapshot before a
        // concurrent overwrite/reset rotated the generation. Fail closed so
        // neither that balance nor a synthetic replacement reaches the new
        // snapshot.
        this.assertCacheGeneration(expectedGeneration);
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
    const expectedGeneration = this.expectedCacheGeneration();
    return this.readAtGeneration(
      expectedGeneration,
      () => this.storage.listAccounts()
    );
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

    const expectedGeneration = this.expectedCacheGeneration();
    const generation = await withFileLocks(
      [this.accountLockKey(), this.resourceLockKey()],
      async () => {
        this.assertCacheGeneration(expectedGeneration);
        const nextGeneration = beginCacheGenerationTransition(this.forkPath);
        this.storage.clearAccounts();
        this.storage.clearResources();
        commitCacheGenerationTransition(this.forkPath, nextGeneration);
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
    const expectedGeneration = this.expectedCacheGeneration();

    try {
      return await this.getAccount(normalizedAddress);
    } catch (error) {
      if (!(error instanceof ForkDataNotFoundError)) throw error;
      const newAccount: AccountState = {
        sequenceNumber: '0',
        authenticationKey: forkAuthKeyPlaceholder(normalizedAddress),
      };

      const account = await withFileLock(this.accountLockKey(), async () => {
        this.assertCacheGeneration(expectedGeneration);
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
