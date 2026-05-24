import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  statSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir, platform } from "os";
import { join } from "path";
import { AccountManager } from "../AccountManager.js";
import type { MovehatConfig } from "../../types/config.js";

const TEST_KEY_A =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const TEST_KEY_B =
  "0x0000000000000000000000000000000000000000000000000000000000000002";

describe("AccountManager.saveAccountPool", () => {
  let tmpDir: string;
  let mgr: AccountManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-acc-pool-"));
    mgr = new AccountManager();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes test-pool.json with 0o600 permissions", () => {
    mgr.createAccount("alice");
    mgr.createAccount("bob");

    const poolDir = join(tmpDir, "accounts");
    mgr.saveAccountPool(poolDir);

    const poolFile = join(poolDir, "test-pool.json");
    expect(existsSync(poolFile)).toBe(true);

    if (platform() !== "win32") {
      const stat = statSync(poolFile);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("creates the pool directory with 0o700 permissions when missing", () => {
    mgr.createAccount("alice");

    const poolDir = join(tmpDir, "fresh-accounts");
    mgr.saveAccountPool(poolDir);

    expect(existsSync(poolDir)).toBe(true);

    if (platform() !== "win32") {
      const stat = statSync(poolDir);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o700);
    }
  });

  it("omits imported private-key accounts by default", () => {
    const generated = mgr.createAccount("alice");
    mgr.loadAccountFromPrivateKey(TEST_KEY_A);

    const poolDir = join(tmpDir, "accounts");
    mgr.saveAccountPool(poolDir);

    const poolData = JSON.parse(
      readFileSync(join(poolDir, "test-pool.json"), "utf-8")
    );
    expect(poolData.accounts).toHaveLength(1);
    expect(poolData.accounts[0].address).toBe(
      generated.accountAddress.toString()
    );
    expect(JSON.stringify(poolData)).not.toContain(TEST_KEY_A);
  });

  it("persists imported private-key accounts only when includeImported is explicit", () => {
    mgr.createAccount("alice");
    const imported = mgr.loadAccountFromPrivateKey(TEST_KEY_A);

    const poolDir = join(tmpDir, "accounts-with-imported");
    mgr.saveAccountPool(poolDir, { includeImported: true });

    const poolData = JSON.parse(
      readFileSync(join(poolDir, "test-pool.json"), "utf-8")
    );
    expect(poolData.accounts).toHaveLength(2);
    const addresses = poolData.accounts.map(
      (account: { address: string }) => account.address
    );
    expect(addresses).toContain(imported.accountAddress.toString());
    expect(JSON.stringify(poolData)).toContain(TEST_KEY_A);
  });
});

describe("AccountManager — create / lookup / label", () => {
  let mgr: AccountManager;

  beforeEach(() => {
    mgr = new AccountManager();
  });

  it("getTestAccount(label) creates on first call, returns the same on second", () => {
    const first = mgr.getTestAccount("alice");
    const second = mgr.getTestAccount("alice");
    expect(second.accountAddress.toString()).toBe(first.accountAddress.toString());
  });

  it("getTestAccount() with no label creates a fresh unlabeled account", () => {
    const a = mgr.getTestAccount();
    const b = mgr.getTestAccount();
    expect(a.accountAddress.toString()).not.toBe(b.accountAddress.toString());
  });

  it("createAccount tracks the new account in the pool", () => {
    expect(mgr.getPoolSize()).toBe(0);
    mgr.createAccount("alice");
    mgr.createAccount("bob");
    expect(mgr.getPoolSize()).toBe(2);
  });

  it("getAccountByLabel returns undefined for an unknown label", () => {
    expect(mgr.getAccountByLabel("missing")).toBeUndefined();
  });

  it("getLabeledAccounts returns a map of every labeled account", () => {
    mgr.createAccount("alice");
    mgr.createAccount("bob");
    mgr.createAccount(); // unlabeled — should NOT appear
    const labeled = mgr.getLabeledAccounts();
    expect(Object.keys(labeled).sort()).toEqual(["alice", "bob"]);
  });

  it("hasLabel reflects the label map state", () => {
    expect(mgr.hasLabel("alice")).toBe(false);
    mgr.createAccount("alice");
    expect(mgr.hasLabel("alice")).toBe(true);
  });

  it("getOrCreateLabeled returns the existing labeled account on second call", () => {
    const first = mgr.getOrCreateLabeled("alice");
    const second = mgr.getOrCreateLabeled("alice");
    expect(second.accountAddress.toString()).toBe(first.accountAddress.toString());
    expect(mgr.getPoolSize()).toBe(1);
  });

  it("createBatch creates one account per label and returns the map", () => {
    const accounts = mgr.createBatch(["alice", "bob", "charlie"]);
    expect(Object.keys(accounts).sort()).toEqual(["alice", "bob", "charlie"]);
    expect(mgr.getPoolSize()).toBe(3);
  });

  it("getAllAccounts returns every account in insertion order", () => {
    const a = mgr.createAccount("alice");
    const b = mgr.createAccount("bob");
    const addrs = mgr.getAllAccounts().map((acc) =>
      acc.accountAddress.toString()
    );
    expect(addrs).toEqual([
      a.accountAddress.toString(),
      b.accountAddress.toString(),
    ]);
  });

  it("clearPool resets pool, label map, and poolLoaded flag", () => {
    mgr.createAccount("alice");
    expect(mgr.getPoolSize()).toBe(1);
    mgr.clearPool();
    expect(mgr.getPoolSize()).toBe(0);
    expect(mgr.hasLabel("alice")).toBe(false);
  });
});

describe("AccountManager — load from env / key / config", () => {
  let mgr: AccountManager;
  let origEnv: string | undefined;

  beforeEach(() => {
    mgr = new AccountManager();
    origEnv = process.env.PRIVATE_KEY;
    delete process.env.PRIVATE_KEY;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.PRIVATE_KEY;
    else process.env.PRIVATE_KEY = origEnv;
  });

  it("loadAccountFromEnv reads from PRIVATE_KEY by default", () => {
    process.env.PRIVATE_KEY = TEST_KEY_A;
    const acc = mgr.loadAccountFromEnv();
    expect(acc.accountAddress.toString()).toMatch(/^0x[a-f0-9]+$/i);
  });

  it("loadAccountFromEnv reads from a custom env var name", () => {
    process.env.MY_CUSTOM_KEY = TEST_KEY_A;
    try {
      const acc = mgr.loadAccountFromEnv("MY_CUSTOM_KEY");
      expect(acc.accountAddress.toString()).toMatch(/^0x[a-f0-9]+$/i);
    } finally {
      delete process.env.MY_CUSTOM_KEY;
    }
  });

  it("loadAccountFromEnv throws when the env var is unset", () => {
    expect(() => mgr.loadAccountFromEnv("DEFINITELY_NOT_SET")).toThrow(
      /not found/
    );
  });

  it("loadAccountFromPrivateKey adds the account to the pool", () => {
    expect(mgr.getPoolSize()).toBe(0);
    mgr.loadAccountFromPrivateKey(TEST_KEY_A);
    expect(mgr.getPoolSize()).toBe(1);
  });

  it("loadAccountsFromConfig loads every valid key", () => {
    const config = {
      allAccounts: [TEST_KEY_A, TEST_KEY_B],
    } as unknown as MovehatConfig;
    const accounts = mgr.loadAccountsFromConfig(config);
    expect(accounts).toHaveLength(2);
  });

  it("loadAccountsFromConfig warns on a malformed key and skips it", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = {
      allAccounts: [TEST_KEY_A, "not-a-real-key"],
    } as unknown as MovehatConfig;
    const accounts = mgr.loadAccountsFromConfig(config);
    expect(accounts).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to load account from config/)
    );
    warnSpy.mockRestore();
  });
});

describe("AccountManager.loadAccountPool / exportPrivateKeys", () => {
  let tmpDir: string;
  let mgr: AccountManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-acc-load-"));
    mgr = new AccountManager();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("loadAccountPool returns false when the file does not exist", () => {
    expect(mgr.loadAccountPool(tmpDir)).toBe(false);
  });

  it("loadAccountPool restores accounts and labels from disk", () => {
    mgr.createAccount("alice");
    mgr.createAccount("bob");
    const poolDir = join(tmpDir, "accounts");
    mgr.saveAccountPool(poolDir);

    // Load into a fresh manager instance to prove the round-trip works
    // across boundaries, not just on the same in-memory pool.
    const restored = new AccountManager();
    const ok = restored.loadAccountPool(poolDir);
    expect(ok).toBe(true);
    expect(restored.getPoolSize()).toBe(2);
    expect(restored.hasLabel("alice")).toBe(true);
    expect(restored.hasLabel("bob")).toBe(true);
  });

  it("loadAccountPool is a no-op when poolLoaded is already true", () => {
    mgr.createAccount("alice");
    const poolDir = join(tmpDir, "accounts");
    mgr.saveAccountPool(poolDir);

    const restored = new AccountManager();
    expect(restored.loadAccountPool(poolDir)).toBe(true);
    // Second call short-circuits via the poolLoaded flag.
    expect(restored.loadAccountPool(poolDir)).toBe(true);
  });

  it("loadAccountPool returns false and warns on corrupt JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const poolDir = join(tmpDir, "accounts");
    mgr.createAccount("alice");
    mgr.saveAccountPool(poolDir);
    writeFileSync(join(poolDir, "test-pool.json"), "{ not valid json");

    const restored = new AccountManager();
    expect(restored.loadAccountPool(poolDir)).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to load account pool/)
    );
    warnSpy.mockRestore();
  });

  it("exportPrivateKeys returns every labeled account's key when called with no args", () => {
    mgr.createAccount("alice");
    mgr.createAccount("bob");
    const exported = mgr.exportPrivateKeys();
    expect(Object.keys(exported).sort()).toEqual(["alice", "bob"]);
    for (const key of Object.values(exported)) {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("exportPrivateKeys filters by labels when an array is passed", () => {
    mgr.createAccount("alice");
    mgr.createAccount("bob");
    mgr.createAccount("charlie");
    const exported = mgr.exportPrivateKeys(["alice", "charlie"]);
    expect(Object.keys(exported).sort()).toEqual(["alice", "charlie"]);
  });

  it("exportPrivateKeys with an unknown label returns an empty map", () => {
    const exported = mgr.exportPrivateKeys(["missing"]);
    expect(exported).toEqual({});
  });
});
