import { MovementApiClient } from './movement-api.js';
import { ForkStorage } from './fork-storage.js';
import type { ForkMetadata, AccountState } from '../types/fork.js';

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
    const normalizedAddress = this.normalizeAddress(address);

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
    const normalizedAddress = this.normalizeAddress(address);

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
    const normalizedAddress = this.normalizeAddress(address);

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
    const normalizedAddress = this.normalizeAddress(address);
    this.storage.saveResource(normalizedAddress, resourceType, data);
    console.log(`  ✓ Updated resource ${resourceType} for ${normalizedAddress}`);
  }

  /**
   * Fund an account with coins
   */
  async fundAccount(address: string, amount: number, coinType: string = '0x1::aptos_coin::AptosCoin'): Promise<void> {
    const normalizedAddress = this.normalizeAddress(address);
    const resourceType = `0x1::coin::CoinStore<${coinType}>`;

    // Try to get existing coin store
    let coinStore: any;
    try {
      coinStore = await this.getResource(normalizedAddress, resourceType);
    } catch (error) {
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

    // Update balance
    coinStore.coin.value = String(amount);

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
   * Normalize address format
   */
  private normalizeAddress(address: string): string {
    let normalized = address.toLowerCase();

    if (!normalized.startsWith('0x')) {
      normalized = `0x${normalized}`;
    }

    // Pad to 66 characters (0x + 64 hex chars)
    if (normalized.length < 66) {
      normalized = '0x' + normalized.slice(2).padStart(64, '0');
    }

    return normalized;
  }

  /**
   * List all accounts in the fork
   */
  listAccounts(): string[] {
    return this.storage.listAccounts();
  }
}
