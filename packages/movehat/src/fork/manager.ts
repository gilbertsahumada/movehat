import { createHash } from 'node:crypto';
import { MovementApiClient } from './api.js';
import { ForkStorage } from './storage.js';
import type { ForkMetadata, AccountState } from '../types/fork.js';
import { normalizeAddress } from '../utils/address.js';
import { logger } from '../ui/index.js';

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

/**
 * Manager for fork operations
 * Orchestrates API client and storage
 */
export class ForkManager {
  private storage: ForkStorage;
  private apiClient: MovementApiClient | null = null;
  private metadata: ForkMetadata | null = null;

  /**
   * Optional API key sent as `Authorization: Bearer <key>` on every
   * outgoing Movement API request. Not persisted to disk via
   * {@link ForkMetadata} (keys stay in process memory). For the
   * load-then-set pattern, call {@link setApiKey} after `load()`.
   */
  private apiKey?: string;

  constructor(forkPath: string) {
    this.storage = new ForkStorage(forkPath);
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
    apiKey?: string
  ): Promise<void> {
    if (apiKey !== undefined) this.apiKey = apiKey;

    this.apiClient = new MovementApiClient(nodeUrl, this.apiKey);

    const ledgerInfo = await this.apiClient.getLedgerInfo();

    this.storage.initialize();

    this.metadata = {
      network: networkName,
      nodeUrl,
      chainId: ledgerInfo.chain_id,
      ledgerVersion: ledgerInfo.ledger_version,
      timestamp: ledgerInfo.ledger_timestamp,
      epoch: ledgerInfo.epoch,
      blockHeight: ledgerInfo.block_height,
      createdAt: new Date().toISOString(),
    };

    this.storage.saveMetadata(this.metadata);

    logger.success(`Fork initialized at ledger version ${ledgerInfo.ledger_version}`);
  }

  /**
   * Load an existing fork. The API key is NOT persisted to disk —
   * callers needing authenticated upstream reads after `load()` must
   * call {@link setApiKey} explicitly.
   */
  load(): void {
    if (!this.storage.exists()) {
      throw new Error('Fork does not exist. Run `initialize()` first.');
    }

    this.metadata = this.storage.loadMetadata();
    this.apiClient = new MovementApiClient(this.metadata.nodeUrl, this.apiKey);
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

      logger.info(`Fetching account ${normalizedAddress} from network...`, 2);
      const accountData = await this.apiClient.getAccount(normalizedAddress);

      accountState = {
        sequenceNumber: accountData.sequence_number,
        authenticationKey: accountData.authentication_key,
      };

      this.storage.saveAccount(normalizedAddress, accountState);
      logger.success(`Cached account ${normalizedAddress}`, 2);
    }

    return accountState;
  }

  async getResource(address: string, resourceType: string): Promise<any> {
    const normalizedAddress = normalizeAddress(address);

    let resource = this.storage.getResource(normalizedAddress, resourceType);

    if (!resource) {
      if (!this.apiClient) {
        throw new Error('Fork not initialized. Call initialize() or load() first.');
      }

      logger.info(`Fetching resource ${resourceType} for ${normalizedAddress}...`, 2);

      try {
        const resourceData = await this.apiClient.getAccountResource(normalizedAddress, resourceType);
        resource = resourceData.data;

        this.storage.saveResource(normalizedAddress, resourceType, resource);
        logger.success(`Cached resource ${resourceType}`, 2);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('404')) {
          throw new Error(`Resource ${resourceType} not found for account ${normalizedAddress}`);
        }
        throw error;
      }
    }

    return resource;
  }

  async getAllResources(address: string): Promise<Record<string, any>> {
    const normalizedAddress = normalizeAddress(address);

    let resources = this.storage.getAllResources(normalizedAddress);

    if (Object.keys(resources).length === 0) {
      if (!this.apiClient) {
        throw new Error('Fork not initialized. Call initialize() or load() first.');
      }

      logger.info(`Fetching all resources for ${normalizedAddress}...`, 2);
      const resourcesList = await this.apiClient.getAccountResources(normalizedAddress);

      resources = {};
      for (const resource of resourcesList) {
        resources[resource.type] = resource.data;
      }

      this.storage.saveAllResources(normalizedAddress, resources);
      logger.success(`Cached ${Object.keys(resources).length} resources`, 2);
    }

    return resources;
  }

  /**
   * Stateless passthrough of `POST /v1/view` to the upstream RPC.
   *
   * View results are not cached — they depend on ledger version and
   * arguments, so any caching layer would need version-aware
   * invalidation that the fork system does not implement today. The
   * payload is forwarded verbatim and the upstream response array is
   * returned unchanged.
   */
  async forwardView(payload: unknown): Promise<unknown[]> {
    if (!this.apiClient) {
      throw new Error('Fork not initialized. Call initialize() or load() first.');
    }
    return this.apiClient.view(payload);
  }

  async setResource(address: string, resourceType: string, data: unknown): Promise<void> {
    const normalizedAddress = normalizeAddress(address);
    this.storage.saveResource(normalizedAddress, resourceType, data);
    logger.success(`Updated resource ${resourceType} for ${normalizedAddress}`, 2);
  }

  /** Adds to the existing balance rather than replacing it. */
  async fundAccount(address: string, amount: number, coinType: string = '0x1::aptos_coin::AptosCoin'): Promise<void> {
    const normalizedAddress = normalizeAddress(address);
    const resourceType = `0x1::coin::CoinStore<${coinType}>`;

    // Try to get existing coin store. The coin store is a CoinStore<T>
    // resource whose `data` is Movement-side untyped JSON; we shape it
    // locally as a structural object with `coin.value: string`.
    // any: full CoinStore schema lives at the Movement REST boundary —
    // proper validation deferred to the boundary-validation follow-up of #57.
    let coinStore: any;
    try {
      coinStore = await this.getResource(normalizedAddress, resourceType);
    } catch (error) {
      // Only catch "not found" errors, rethrow others (network, API, etc.)
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('not found')) {
        throw error;
      }

      coinStore = {
        coin: { value: '0' },
        deposit_events: {
          counter: '0',
          guid: {
            id: {
              addr: normalizedAddress,
              creation_num: '0',
            },
          },
        },
        withdraw_events: {
          counter: '0',
          guid: {
            id: {
              addr: normalizedAddress,
              creation_num: '1',
            },
          },
        },
        frozen: false,
      };
    }

    const currentBalance = BigInt(coinStore.coin.value ?? '0');
    const newBalance = currentBalance + BigInt(amount);
    coinStore.coin.value = newBalance.toString();

    await this.setResource(normalizedAddress, resourceType, coinStore);

    let account = this.storage.getAccount(normalizedAddress);
    if (!account) {
      account = {
        sequenceNumber: '0',
        authenticationKey: forkAuthKeyPlaceholder(normalizedAddress),
      };
      this.storage.saveAccount(normalizedAddress, account);
    }

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

    // Clear all accounts and resources from storage
    this.storage.clearAccounts();
    this.storage.clearResources();

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
      const newAccount: AccountState = {
        sequenceNumber: '0',
        authenticationKey: forkAuthKeyPlaceholder(normalizedAddress),
      };

      this.storage.saveAccount(normalizedAddress, newAccount);
      logger.success(`Created new account ${normalizedAddress}`, 2);

      return newAccount;
    }
  }
}
