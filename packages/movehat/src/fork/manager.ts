import { MovementApiClient } from './api.js';
import { ForkStorage } from './storage.js';
import type { ForkMetadata, AccountState } from '../types/fork.js';
import { normalizeAddress } from '../utils/address.js';
import { logger } from '../ui/index.js';

/**
 * Manager for fork operations
 * Orchestrates API client and storage
 */
export class ForkManager {
  private storage: ForkStorage;
  private apiClient: MovementApiClient | null = null;
  private metadata: ForkMetadata | null = null;

  constructor(forkPath: string) {
    this.storage = new ForkStorage(forkPath);
  }

  /**
   * Initialize a new fork from a network
   */
  async initialize(nodeUrl: string, networkName: string = 'custom'): Promise<void> {
    // Create API client
    this.apiClient = new MovementApiClient(nodeUrl);

    // Fetch network info
    const ledgerInfo = await this.apiClient.getLedgerInfo();

    // Create fork structure
    this.storage.initialize();

    // Save metadata
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

    console.log(`✓ Fork initialized at ledger version ${ledgerInfo.ledger_version}`);
  }

  /**
   * Load an existing fork
   */
  load(): void {
    if (!this.storage.exists()) {
      throw new Error('Fork does not exist. Run `initialize()` first.');
    }

    this.metadata = this.storage.loadMetadata();
    this.apiClient = new MovementApiClient(this.metadata.nodeUrl);
  }

  /**
   * Get fork metadata
   */
  getMetadata(): ForkMetadata {
    if (!this.metadata) {
      this.metadata = this.storage.loadMetadata();
    }
    return this.metadata;
  }

  /**
   * Get account state (with lazy loading)
   */
  async getAccount(address: string): Promise<AccountState> {
    // Normalize address
    const normalizedAddress = normalizeAddress(address);

    // Check cache first
    let accountState = this.storage.getAccount(normalizedAddress);

    if (!accountState) {
      // Fetch from network
      if (!this.apiClient) {
        throw new Error('Fork not initialized. Call initialize() or load() first.');
      }

      console.log(`  Fetching account ${normalizedAddress} from network...`);
      const accountData = await this.apiClient.getAccount(normalizedAddress);

      accountState = {
        sequenceNumber: accountData.sequence_number,
        authenticationKey: accountData.authentication_key,
      };

      // Cache it
      this.storage.saveAccount(normalizedAddress, accountState);
      console.log(`  ✓ Cached account ${normalizedAddress}`);
    }

    return accountState;
  }

  /**
   * Get a specific resource (with lazy loading)
   */
  async getResource(address: string, resourceType: string): Promise<any> {
    const normalizedAddress = normalizeAddress(address);

    // Check cache first
    let resource = this.storage.getResource(normalizedAddress, resourceType);

    if (!resource) {
      // Fetch from network
      if (!this.apiClient) {
        throw new Error('Fork not initialized. Call initialize() or load() first.');
      }

      console.log(`  Fetching resource ${resourceType} for ${normalizedAddress}...`);

      try {
        const resourceData = await this.apiClient.getAccountResource(normalizedAddress, resourceType);
        resource = resourceData.data;

        // Cache it
        this.storage.saveResource(normalizedAddress, resourceType, resource);
        console.log(`  ✓ Cached resource ${resourceType}`);
      } catch (error: any) {
        if (error.message.includes('404')) {
          throw new Error(`Resource ${resourceType} not found for account ${normalizedAddress}`);
        }
        throw error;
      }
    }

    return resource;
  }

  /**
   * Get all resources for an account (with lazy loading)
   */
  async getAllResources(address: string): Promise<Record<string, any>> {
    const normalizedAddress = normalizeAddress(address);

    // Check if we have any cached resources
    let resources = this.storage.getAllResources(normalizedAddress);

    // If no cached resources, fetch all from network
    if (Object.keys(resources).length === 0) {
      if (!this.apiClient) {
        throw new Error('Fork not initialized. Call initialize() or load() first.');
      }

      console.log(`  Fetching all resources for ${normalizedAddress}...`);
      const resourcesList = await this.apiClient.getAccountResources(normalizedAddress);

      resources = {};
      for (const resource of resourcesList) {
        resources[resource.type] = resource.data;
      }

      // Cache them
      this.storage.saveAllResources(normalizedAddress, resources);
      console.log(`  ✓ Cached ${Object.keys(resources).length} resources`);
    }

    return resources;
  }

  /**
   * Set a resource value (for testing/mocking)
   */
  async setResource(address: string, resourceType: string, data: any): Promise<void> {
    const normalizedAddress = normalizeAddress(address);
    this.storage.saveResource(normalizedAddress, resourceType, data);
    console.log(`  ✓ Updated resource ${resourceType} for ${normalizedAddress}`);
  }

  /**
   * Fund an account with coins (adds to existing balance)
   */
  async fundAccount(address: string, amount: number, coinType: string = '0x1::aptos_coin::AptosCoin'): Promise<void> {
    const normalizedAddress = normalizeAddress(address);
    const resourceType = `0x1::coin::CoinStore<${coinType}>`;

    // Try to get existing coin store
    let coinStore: any;
    try {
      coinStore = await this.getResource(normalizedAddress, resourceType);
    } catch (error: any) {
      // Only catch "not found" errors, rethrow others (network, API, etc.)
      if (!error.message || !error.message.includes('not found')) {
        throw error;
      }

      // If doesn't exist, create new one
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

    // Add to existing balance (instead of replacing it)
    const currentBalance = BigInt(coinStore.coin.value ?? '0');
    const newBalance = currentBalance + BigInt(amount);
    coinStore.coin.value = newBalance.toString();

    // Save
    await this.setResource(normalizedAddress, resourceType, coinStore);

    // Also ensure account exists
    let account = this.storage.getAccount(normalizedAddress);
    if (!account) {
      account = {
        sequenceNumber: '0',
        authenticationKey: normalizedAddress.padEnd(66, '0'),
      };
      this.storage.saveAccount(normalizedAddress, account);
    }

    console.log(`  ✓ Funded ${normalizedAddress} with ${amount} coins`);
  }

  /**
   * List all accounts in the fork
   */
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
   *   100_000_000 // 100 APT
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

    // Try to get existing account
    try {
      return await this.getAccount(normalizedAddress);
    } catch (error) {
      // If account doesn't exist, create a minimal one
      const newAccount: AccountState = {
        sequenceNumber: '0',
        authenticationKey: normalizedAddress.padEnd(66, '0'),
      };

      this.storage.saveAccount(normalizedAddress, newAccount);
      console.log(`  ✓ Created new account ${normalizedAddress}`);

      return newAccount;
    }
  }
}
