import {
  Account,
  Ed25519PrivateKey,
  PrivateKey,
  PrivateKeyVariants,
} from "@aptos-labs/ts-sdk";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { MovehatConfig } from "../types/config.js";
import { logger } from "../ui/index.js";

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

export interface SaveAccountPoolOptions {
  /**
   * Persist accounts loaded from a private key, environment variable, or
   * config. Defaults to false so imported live keys are not written to disk
   * accidentally when callers only intend to save generated test accounts.
   */
  includeImported?: boolean | undefined;
}

export interface AccountManagerOptions {
  /**
   * Filesystem location where `saveAccountPool` writes `test-pool.json`
   * and `loadAccountPool` reads from. When omitted, the path is computed
   * LAZILY on each call from `join(process.cwd(), ".movehat", "accounts")`
   * — so `process.chdir()` between construction and pool I/O is respected.
   *
   * Pass an explicit value when per-instance isolation matters (parallel
   * test files, harness pools that must not collide with another suite's).
   */
  poolPath?: string | undefined;
}

/**
 * Centralized Account Manager for movehat.
 *
 * Manages account creation, loading, and lifecycle. Provides a pool of
 * reusable test accounts with labels for better test readability.
 *
 * `new AccountManager(options?)` gives a fully isolated pool. Two
 * instances in the same process have independent labelMaps,
 * private-key maps, and account pools. Each `Harness` owns one of
 * these; user code accesses labeled accounts via
 * `harness.accounts.<label>` (Harness snapshots them at construction
 * time).
 */
export class AccountManager {
  // ── Instance state ──────────────────────────────────────────────
  private readonly pool: Map<string, Account> = new Map(); // address → Account
  private readonly privateKeys: Map<string, string> = new Map(); // address → privateKey hex
  private readonly labelMap: Map<string, string> = new Map(); // label → address
  private readonly generatedAccountAddresses: Set<string> = new Set();
  private poolLoaded = false;
  private readonly poolPathOverride: string | undefined;

  constructor(options: AccountManagerOptions = {}) {
    this.poolPathOverride = options.poolPath;
  }

  /**
   * Resolved pool directory. When the caller supplied an explicit
   * `poolPath` to the constructor, that value is returned verbatim.
   * Otherwise the path is computed LAZILY from the current
   * `process.cwd()` on each access — so `process.chdir()` performed
   * between construction and pool I/O takes effect, unlike the legacy
   * static-only API which captured cwd at module import time
   * (audit finding F8(b)).
   */
  private get poolPath(): string {
    return this.poolPathOverride ?? join(process.cwd(), ".movehat", "accounts");
  }

  // ── Instance methods (real implementations) ─────────────────────

  /**
   * Get a test account from the pool. If label is provided and exists,
   * returns that account. Otherwise creates a new account with the
   * optional label.
   *
   * @param label Optional label for the account (e.g., "alice", "bob")
   * @returns An Account instance
   */
  getTestAccount(label?: string): Account {
    if (label) {
      const existing = this.getAccountByLabel(label);
      if (existing) {
        return existing;
      }
    }
    return this.createAccount(label, false);
  }

  /**
   * Create a new account and optionally add it to the pool with a
   * label. The `fund` parameter is accepted for API symmetry; actual
   * funding is the caller's responsibility.
   */
  createAccount(label?: string, _fund: boolean = false): Account {
    const account = Account.generate();
    const address = account.accountAddress.toString();

    this.pool.set(address, account);
    this.privateKeys.set(address, account.privateKey.toString());
    this.generatedAccountAddresses.add(address);

    if (label) {
      this.labelMap.set(label, address);
    }

    return account;
  }

  /**
   * Get an account by its label, or undefined if not present.
   */
  getAccountByLabel(label: string): Account | undefined {
    const address = this.labelMap.get(label);
    if (!address) {
      return undefined;
    }
    return this.pool.get(address);
  }

  /**
   * Load account from environment variable.
   *
   * @throws Error if the environment variable is not set
   */
  loadAccountFromEnv(envVar: string = "PRIVATE_KEY"): Account {
    const privateKeyHex = process.env[envVar];
    if (!privateKeyHex) {
      throw new Error(
        `Environment variable ${envVar} not found. ` +
          `Set it in your .env file or environment.`,
      );
    }
    return this.loadAccountFromPrivateKey(privateKeyHex);
  }

  /**
   * Load account from a private key hex string (with or without 0x prefix).
   */
  loadAccountFromPrivateKey(privateKeyHex: string): Account {
    // Format into AIP-80 shape (`ed25519-priv-0x…`) before constructing
    // the SDK type. Without this, raw-hex inputs trigger a noisy
    // deprecation warning from `@aptos-labs/ts-sdk` on every call.
    const account = this.accountFromPrivateKey(privateKeyHex);
    this.trackAccount(account, privateKeyHex, "imported");
    return account;
  }

  /**
   * Load all accounts from movehat config.
   */
  loadAccountsFromConfig(config: MovehatConfig): Account[] {
    const accounts: Account[] = [];
    for (const privateKeyHex of config.allAccounts) {
      try {
        const account = this.loadAccountFromPrivateKey(privateKeyHex);
        accounts.push(account);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warning(`Failed to load account from config: ${msg}`);
      }
    }
    return accounts;
  }

  /**
   * Get all labeled accounts in the pool.
   */
  getLabeledAccounts(): Record<string, Account> {
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
   * Save the current account pool to disk for persistence.
   */
  saveAccountPool(): void;
  saveAccountPool(poolPath: string): void;
  saveAccountPool(options: SaveAccountPoolOptions): void;
  saveAccountPool(poolPath: string, options: SaveAccountPoolOptions): void;
  saveAccountPool(
    poolPathOrOptions?: string | SaveAccountPoolOptions,
    options: SaveAccountPoolOptions = {},
  ): void {
    const explicitPath =
      typeof poolPathOrOptions === "string" ? poolPathOrOptions : undefined;
    const effectiveOptions =
      typeof poolPathOrOptions === "object" && poolPathOrOptions !== null
        ? poolPathOrOptions
        : options;
    const includeImported = effectiveOptions.includeImported ?? false;
    const basePath = explicitPath || this.poolPath;

    // Ensure directory exists with restrictive perms (the pool file holds
    // plaintext private keys, so the directory must not be world-readable).
    // mkdirSync's mode is masked by the process umask; chmod explicitly
    // afterwards to guarantee 0o700.
    if (!existsSync(basePath)) {
      mkdirSync(basePath, { recursive: true, mode: 0o700 });
    }
    chmodSync(basePath, 0o700);

    const storedAccounts: StoredAccount[] = [];
    const labelMapObject: Record<string, string> = {};

    for (const [address, account] of this.pool.entries()) {
      void account;
      if (!includeImported && !this.generatedAccountAddresses.has(address)) {
        continue;
      }

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
        logger.warning(`No private key found for account ${address}, skipping`);
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

    const poolFilePath = join(basePath, "test-pool.json");
    writeFileSync(poolFilePath, JSON.stringify(poolData, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    chmodSync(poolFilePath, 0o600);
  }

  /**
   * Load account pool from disk. Returns true if a pool file was found
   * and parsed, false if the file does not exist or parsing failed.
   */
  loadAccountPool(poolPath?: string): boolean {
    if (this.poolLoaded) {
      return true;
    }

    const basePath = poolPath || this.poolPath;
    const poolFilePath = join(basePath, "test-pool.json");

    if (!existsSync(poolFilePath)) {
      return false;
    }

    try {
      const poolData: AccountPool = JSON.parse(readFileSync(poolFilePath, "utf-8"));

      this.pool.clear();
      this.labelMap.clear();

      for (const stored of poolData.accounts) {
        const account = this.accountFromPrivateKey(stored.privateKey);
        this.trackAccount(account, stored.privateKey, "generated");

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
      logger.warning(`Failed to load account pool: ${msg}`);
      return false;
    }
  }

  /**
   * Clear the entire account pool. Useful for test isolation.
   */
  clearPool(): void {
    this.pool.clear();
    this.privateKeys.clear();
    this.labelMap.clear();
    this.generatedAccountAddresses.clear();
    this.poolLoaded = false;
  }

  /**
   * Number of accounts in the pool.
   */
  getPoolSize(): number {
    return this.pool.size;
  }

  /**
   * All accounts in the pool.
   */
  getAllAccounts(): Account[] {
    return Array.from(this.pool.values());
  }

  /**
   * Whether a label is currently bound to an account in this pool.
   */
  hasLabel(label: string): boolean {
    return this.labelMap.has(label);
  }

  /**
   * Get or create an account with a specific label.
   */
  getOrCreateLabeled(label: string): Account {
    const existing = this.getAccountByLabel(label);
    if (existing) {
      return existing;
    }
    return this.createAccount(label, false);
  }

  /**
   * Batch create multiple labeled accounts.
   */
  createBatch(labels: readonly string[]): Record<string, Account> {
    const result: Record<string, Account> = {};
    for (const label of labels) {
      result[label] = this.getOrCreateLabeled(label);
    }
    return result;
  }

  /**
   * Export account private keys for backup/sharing.
   * WARNING: Only use this for test accounts, never production keys.
   */
  exportPrivateKeys(labels?: string[]): Record<string, string> {
    const result: Record<string, string> = {};

    if (labels) {
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
      for (const [label, address] of this.labelMap.entries()) {
        const privateKey = this.privateKeys.get(address);
        if (privateKey) {
          result[label] = privateKey;
        }
      }
    }

    return result;
  }

  private accountFromPrivateKey(privateKeyHex: string): Account {
    const formatted = PrivateKey.formatPrivateKey(
      privateKeyHex,
      PrivateKeyVariants.Ed25519,
    );
    const privateKey = new Ed25519PrivateKey(formatted);
    return Account.fromPrivateKey({ privateKey });
  }

  private trackAccount(
    account: Account,
    privateKeyHex: string,
    source: "generated" | "imported",
  ): void {
    const address = account.accountAddress.toString();
    this.pool.set(address, account);
    this.privateKeys.set(address, privateKeyHex);

    if (source === "generated") {
      this.generatedAccountAddresses.add(address);
    } else {
      this.generatedAccountAddresses.delete(address);
    }
  }
}
