import {
  Account,
  Ed25519PrivateKey,
  PrivateKey,
  PrivateKeyVariants,
} from "@aptos-labs/ts-sdk";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { MovehatConfig } from "../types/config.js";

export interface StoredAccount {
  label?: string | undefined;
  privateKey: string;
  address: string;
  createdAt: number;
}

interface AccountPool {
  accounts: StoredAccount[];
  labelMap: Record<string, string>; // label → address
}

/**
 * Centralized Account Manager for movehat
 *
 * Manages all account creation, loading, and lifecycle operations.
 * Provides a pool of reusable test accounts with labels for better test readability.
 */
export class AccountManager {
  private static pool: Map<string, Account> = new Map(); // address → Account
  private static privateKeys: Map<string, string> = new Map(); // address → privateKey hex
  private static labelMap: Map<string, string> = new Map(); // label → address
  private static poolLoaded = false;
  private static defaultPoolPath = join(process.cwd(), ".movehat", "accounts");

  /**
   * Get a test account from the pool. If label is provided and exists, returns that account.
   * Otherwise creates a new account with the optional label.
   *
   * @param label Optional label for the account (e.g., "alice", "bob", "deployer")
   * @returns An Account instance
   *
   * @example
   * const alice = AccountManager.getTestAccount("alice");
   * const randomAccount = AccountManager.getTestAccount();
   */
  static getTestAccount(label?: string): Account {
    if (label) {
      const existingAccount = this.getAccountByLabel(label);
      if (existingAccount) {
        return existingAccount;
      }
    }

    return this.createAccount(label, false);
  }

  /**
   * Create a new account and optionally add it to the pool with a label
   *
   * @param label Optional label for the account
   * @param fund Whether to fund the account (handled externally)
   * @returns A new Account instance
   *
   * @example
   * const deployer = AccountManager.createAccount("deployer");
   * const bob = AccountManager.createAccount("bob", true);
   */
  static createAccount(label?: string, fund: boolean = false): Account {
    const account = Account.generate();
    const address = account.accountAddress.toString();

    this.pool.set(address, account);
    this.privateKeys.set(address, account.privateKey.toString());

    if (label) {
      this.labelMap.set(label, address);
    }

    return account;
  }

  /**
   * Get an account by its label
   *
   * @param label The label to look up
   * @returns The Account if found, undefined otherwise
   *
   * @example
   * const alice = AccountManager.getAccountByLabel("alice");
   * if (alice) {
   *   console.log(`Alice's address: ${alice.accountAddress.toString()}`);
   * }
   */
  static getAccountByLabel(label: string): Account | undefined {
    const address = this.labelMap.get(label);
    if (!address) {
      return undefined;
    }
    return this.pool.get(address);
  }

  /**
   * Load account from environment variable
   *
   * @param envVar The environment variable name (defaults to "PRIVATE_KEY")
   * @returns Account instance
   * @throws Error if environment variable is not set
   *
   * @example
   * const account = AccountManager.loadAccountFromEnv("MH_PRIVATE_KEY");
   */
  static loadAccountFromEnv(envVar: string = "PRIVATE_KEY"): Account {
    const privateKeyHex = process.env[envVar];

    if (!privateKeyHex) {
      throw new Error(
        `Environment variable ${envVar} not found. ` +
        `Set it in your .env file or environment.`
      );
    }

    return this.loadAccountFromPrivateKey(privateKeyHex);
  }

  /**
   * Load account from a private key hex string
   *
   * @param privateKeyHex The private key as a hex string (with or without 0x prefix)
   * @returns Account instance
   *
   * @example
   * const account = AccountManager.loadAccountFromPrivateKey("0xabc123...");
   */
  static loadAccountFromPrivateKey(privateKeyHex: string): Account {
    // Format into AIP-80 shape (`ed25519-priv-0x…`) before constructing
    // the SDK type. Without this, raw-hex inputs trigger a noisy
    // deprecation warning from `@aptos-labs/ts-sdk` on every call.
    const formatted = PrivateKey.formatPrivateKey(
      privateKeyHex,
      PrivateKeyVariants.Ed25519,
    );
    const privateKey = new Ed25519PrivateKey(formatted);
    const account = Account.fromPrivateKey({ privateKey });
    const address = account.accountAddress.toString();

    // Add to pool for tracking
    this.pool.set(address, account);

    // Store private key
    this.privateKeys.set(address, privateKeyHex);

    return account;
  }

  /**
   * Load all accounts from movehat config
   *
   * @param config The resolved MovehatConfig
   * @returns Array of Account instances
   *
   * @example
   * const config = await resolveNetworkConfig(userConfig);
   * const accounts = AccountManager.loadAccountsFromConfig(config);
   */
  static loadAccountsFromConfig(config: MovehatConfig): Account[] {
    const accounts: Account[] = [];

    for (const privateKeyHex of config.allAccounts) {
      try {
        const account = this.loadAccountFromPrivateKey(privateKeyHex);
        accounts.push(account);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(
          `Warning: Failed to load account from config: ${msg}`
        );
      }
    }

    return accounts;
  }

  /**
   * Get all labeled accounts in the pool
   *
   * @returns Record of label to Account mappings
   *
   * @example
   * const labeled = AccountManager.getLabeledAccounts();
   * console.log(`Deployer: ${labeled.deployer?.accountAddress.toString()}`);
   */
  static getLabeledAccounts(): Record<string, Account> {
    const result: Record<string, Account> = {};

    for (const [label, address] of this.labelMap.entries()) {
      const account = this.pool.get(address);
      if (account) {
        result[label] = account;
      }
    }

    return result;
  }

  /**
   * Save the current account pool to disk for persistence
   *
   * @param poolPath Optional custom path (defaults to .movehat/accounts)
   *
   * @example
   * AccountManager.saveAccountPool();
   */
  static saveAccountPool(poolPath?: string): void {
    const basePath = poolPath || this.defaultPoolPath;

    // Ensure directory exists with restrictive perms (the pool file holds
    // plaintext private keys, so the directory must not be world-readable).
    // Note: mkdirSync's mode is masked by the process umask, so we chmod
    // explicitly afterwards to guarantee 0o700 regardless of umask.
    if (!existsSync(basePath)) {
      mkdirSync(basePath, { recursive: true, mode: 0o700 });
    }
    chmodSync(basePath, 0o700);

    // Build stored accounts array
    const storedAccounts: StoredAccount[] = [];
    const labelMapObject: Record<string, string> = {};

    for (const [address, account] of this.pool.entries()) {
      // Find label for this address (if any)
      let label: string | undefined;
      for (const [lbl, addr] of this.labelMap.entries()) {
        if (addr === address) {
          label = lbl;
          labelMapObject[lbl] = address;
          break;
        }
      }

      const privateKey = this.privateKeys.get(address);
      if (!privateKey) {
        console.warn(`Warning: No private key found for account ${address}, skipping`);
        continue;
      }

      storedAccounts.push({
        label,
        privateKey,
        address,
        createdAt: Date.now(),
      });
    }

    const poolData: AccountPool = {
      accounts: storedAccounts,
      labelMap: labelMapObject,
    };

    // Write to file with owner-only permissions — file contains plaintext
    // private keys for test accounts. writeFileSync's mode is masked by
    // the process umask, so we chmod explicitly afterwards to guarantee
    // 0o600 regardless of umask.
    const poolFilePath = join(basePath, "test-pool.json");
    writeFileSync(poolFilePath, JSON.stringify(poolData, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    chmodSync(poolFilePath, 0o600);
  }

  /**
   * Load account pool from disk
   *
   * @param poolPath Optional custom path (defaults to .movehat/accounts)
   * @returns true if pool was loaded, false if file doesn't exist
   *
   * @example
   * if (AccountManager.loadAccountPool()) {
   *   console.log("Pool loaded successfully");
   * }
   */
  static loadAccountPool(poolPath?: string): boolean {
    if (this.poolLoaded) {
      return true; // Already loaded
    }

    const basePath = poolPath || this.defaultPoolPath;
    const poolFilePath = join(basePath, "test-pool.json");

    if (!existsSync(poolFilePath)) {
      return false;
    }

    try {
      const poolData: AccountPool = JSON.parse(
        readFileSync(poolFilePath, "utf-8")
      );

      // Clear existing pool
      this.pool.clear();
      this.labelMap.clear();

      // Restore accounts
      for (const stored of poolData.accounts) {
        const account = this.loadAccountFromPrivateKey(stored.privateKey);
        this.pool.set(stored.address, account);

        if (stored.label) {
          this.labelMap.set(stored.label, stored.address);
        }
      }

      // Restore label map (in case there are orphaned labels)
      for (const [label, address] of Object.entries(poolData.labelMap)) {
        if (!this.labelMap.has(label)) {
          this.labelMap.set(label, address);
        }
      }

      this.poolLoaded = true;
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `Warning: Failed to load account pool: ${msg}`
      );
      return false;
    }
  }

  /**
   * Clear the entire account pool
   * Useful for test isolation
   *
   * @example
   * after(() => {
   *   AccountManager.clearPool();
   * });
   */
  static clearPool(): void {
    this.pool.clear();
    this.privateKeys.clear();
    this.labelMap.clear();
    this.poolLoaded = false;
  }

  /**
   * Get the current size of the account pool
   *
   * @returns Number of accounts in the pool
   */
  static getPoolSize(): number {
    return this.pool.size;
  }

  /**
   * Get all accounts in the pool
   *
   * @returns Array of all Account instances
   */
  static getAllAccounts(): Account[] {
    return Array.from(this.pool.values());
  }

  /**
   * Check if a label is already in use
   *
   * @param label The label to check
   * @returns true if label exists, false otherwise
   */
  static hasLabel(label: string): boolean {
    return this.labelMap.has(label);
  }

  /**
   * Get or create an account with a specific label
   * If the label exists, returns the existing account
   * Otherwise creates a new account with that label
   *
   * @param label The label for the account
   * @returns Account instance
   *
   * @example
   * const alice = AccountManager.getOrCreateLabeled("alice");
   * const aliceAgain = AccountManager.getOrCreateLabeled("alice"); // Same account
   */
  static getOrCreateLabeled(label: string): Account {
    const existing = this.getAccountByLabel(label);
    if (existing) {
      return existing;
    }
    return this.createAccount(label, false);
  }

  /**
   * Batch create multiple labeled accounts
   *
   * @param labels Array of labels to create
   * @returns Record of label to Account mappings
   *
   * @example
   * const accounts = AccountManager.createBatch(["alice", "bob", "charlie"]);
   * console.log(accounts.alice.accountAddress.toString());
   */
  static createBatch(labels: readonly string[]): Record<string, Account> {
    const result: Record<string, Account> = {};

    for (const label of labels) {
      result[label] = this.getOrCreateLabeled(label);
    }

    return result;
  }

  /**
   * Export account private keys for backup/sharing
   * WARNING: Only use this for test accounts, never production keys
   *
   * @param labels Optional array of labels to export (exports all if not provided)
   * @returns Record of label/address to private key hex string
   */
  static exportPrivateKeys(labels?: string[]): Record<string, string> {
    const result: Record<string, string> = {};

    if (labels) {
      // Export specific labels
      for (const label of labels) {
        const address = this.labelMap.get(label);
        if (address) {
          const privateKey = this.privateKeys.get(address);
          if (privateKey) {
            result[label] = privateKey;
          }
        }
      }
    } else {
      // Export all labeled accounts
      for (const [label, address] of this.labelMap.entries()) {
        const privateKey = this.privateKeys.get(address);
        if (privateKey) {
          result[label] = privateKey;
        }
      }
    }

    return result;
  }
}
