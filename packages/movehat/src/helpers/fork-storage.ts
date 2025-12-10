import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import type { ForkMetadata, AccountState, ResourceData } from '../types/fork.js';

/**
 * Storage system for fork state
 * Manages the file structure and I/O for fork data
 */
export class ForkStorage {
  private forkPath: string;

  constructor(forkPath: string) {
    this.forkPath = forkPath;
  }

  /**
   * Initialize fork directory structure
   */
  initialize(): void {
    // Create main fork directory
    if (!existsSync(this.forkPath)) {
      mkdirSync(this.forkPath, { recursive: true });
    }

    // Create subdirectories
    const resourcesDir = join(this.forkPath, 'resources');
    if (!existsSync(resourcesDir)) {
      mkdirSync(resourcesDir, { recursive: true });
    }

    const cacheDir = join(this.forkPath, 'cache');
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    // Create .gitignore for cache
    const gitignorePath = join(cacheDir, '.gitignore');
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, '*\n!.gitignore\n');
    }

    // Initialize accounts.json if it doesn't exist
    const accountsPath = join(this.forkPath, 'accounts.json');
    if (!existsSync(accountsPath)) {
      writeFileSync(accountsPath, JSON.stringify({}, null, 2));
    }
  }

  /**
   * Check if fork exists
   */
  exists(): boolean {
    return existsSync(this.forkPath) && existsSync(join(this.forkPath, 'metadata.json'));
  }

  /**
   * Save fork metadata
   */
  saveMetadata(metadata: ForkMetadata): void {
    const metadataPath = join(this.forkPath, 'metadata.json');
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Load fork metadata
   */
  loadMetadata(): ForkMetadata {
    const metadataPath = join(this.forkPath, 'metadata.json');

    if (!existsSync(metadataPath)) {
      throw new Error(`Fork metadata not found at ${metadataPath}`);
    }

    const data = readFileSync(metadataPath, 'utf-8');
    return JSON.parse(data);
  }

  /**
   * Get account state
   */
  getAccount(address: string): AccountState | null {
    const accountsPath = join(this.forkPath, 'accounts.json');

    if (!existsSync(accountsPath)) {
      return null;
    }

    const accounts = JSON.parse(readFileSync(accountsPath, 'utf-8'));
    return accounts[address] || null;
  }

  /**
   * Save account state
   */
  saveAccount(address: string, state: AccountState): void {
    const accountsPath = join(this.forkPath, 'accounts.json');

    let accounts: Record<string, AccountState> = {};
    if (existsSync(accountsPath)) {
      accounts = JSON.parse(readFileSync(accountsPath, 'utf-8'));
    }

    accounts[address] = state;
    writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));
  }

  /**
   * Get resource for an account
   */
  getResource(address: string, resourceType: string): any | null {
    const resourceFilePath = join(this.forkPath, 'resources', `${address}.json`);

    if (!existsSync(resourceFilePath)) {
      return null;
    }

    const resources = JSON.parse(readFileSync(resourceFilePath, 'utf-8'));
    return resources[resourceType] || null;
  }

  /**
   * Get all resources for an account
   */
  getAllResources(address: string): Record<string, any> {
    const resourceFilePath = join(this.forkPath, 'resources', `${address}.json`);

    if (!existsSync(resourceFilePath)) {
      return {};
    }

    return JSON.parse(readFileSync(resourceFilePath, 'utf-8'));
  }

  /**
   * Save resource for an account
   */
  saveResource(address: string, resourceType: string, data: any): void {
    const resourceFilePath = join(this.forkPath, 'resources', `${address}.json`);

    let resources: Record<string, any> = {};
    if (existsSync(resourceFilePath)) {
      resources = JSON.parse(readFileSync(resourceFilePath, 'utf-8'));
    }

    resources[resourceType] = data;
    writeFileSync(resourceFilePath, JSON.stringify(resources, null, 2));
  }

  /**
   * Save all resources for an account
   */
  saveAllResources(address: string, resources: Record<string, any>): void {
    const resourceFilePath = join(this.forkPath, 'resources', `${address}.json`);
    writeFileSync(resourceFilePath, JSON.stringify(resources, null, 2));
  }

  /**
   * Check if resource is cached
   */
  hasResource(address: string, resourceType: string): boolean {
    return this.getResource(address, resourceType) !== null;
  }

  /**
   * List all accounts in the fork
   */
  listAccounts(): string[] {
    const accountsPath = join(this.forkPath, 'accounts.json');

    if (!existsSync(accountsPath)) {
      return [];
    }

    const accounts = JSON.parse(readFileSync(accountsPath, 'utf-8'));
    return Object.keys(accounts);
  }
}
