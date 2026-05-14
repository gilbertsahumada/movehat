import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, statSync, existsSync, writeFileSync } from "fs";
import { tmpdir, platform } from "os";
import { join } from "path";
import { AccountManager } from "../AccountManager.js";
import type { MovehatConfig } from "../../types/config.js";

describe("AccountManager.saveAccountPool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-acc-pool-"));
    AccountManager.clearPool();
  });

  afterEach(() => {
    AccountManager.clearPool();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes test-pool.json with 0o600 permissions", () => {
    AccountManager.createAccount("alice");
    AccountManager.createAccount("bob");

    const poolDir = join(tmpDir, "accounts");
    AccountManager.saveAccountPool(poolDir);

    const poolFile = join(poolDir, "test-pool.json");
    expect(existsSync(poolFile)).toBe(true);

    // Mode check is POSIX-only; skip on Windows where mode bits don't apply.
    if (platform() !== "win32") {
      const stat = statSync(poolFile);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("creates the pool directory with 0o700 permissions when missing", () => {
    AccountManager.createAccount("alice");

    const poolDir = join(tmpDir, "fresh-accounts");
    AccountManager.saveAccountPool(poolDir);

    expect(existsSync(poolDir)).toBe(true);

    if (platform() !== "win32") {
      const stat = statSync(poolDir);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o700);
    }
  });
});

const TEST_KEY_A =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const TEST_KEY_B =
  "0x0000000000000000000000000000000000000000000000000000000000000002";

describe("AccountManager — create / lookup / label", () => {
  beforeEach(() => {
    AccountManager.clearPool();
  });

  afterEach(() => {
    AccountManager.clearPool();
  });

  it("getTestAccount(label) creates on first call, returns the same on second", () => {
    const first = AccountManager.getTestAccount("alice");
    const second = AccountManager.getTestAccount("alice");
    expect(second.accountAddress.toString()).toBe(first.accountAddress.toString());
  });

  it("getTestAccount() with no label creates a fresh unlabeled account", () => {
    const a = AccountManager.getTestAccount();
    const b = AccountManager.getTestAccount();
    expect(a.accountAddress.toString()).not.toBe(b.accountAddress.toString());
  });

  it("createAccount tracks the new account in the pool", () => {
    expect(AccountManager.getPoolSize()).toBe(0);
    AccountManager.createAccount("alice");
    AccountManager.createAccount("bob");
    expect(AccountManager.getPoolSize()).toBe(2);
  });

  it("getAccountByLabel returns undefined for an unknown label", () => {
    expect(AccountManager.getAccountByLabel("missing")).toBeUndefined();
  });

  it("getLabeledAccounts returns a map of every labeled account", () => {
    AccountManager.createAccount("alice");
    AccountManager.createAccount("bob");
    AccountManager.createAccount(); // unlabeled — should NOT appear
    const labeled = AccountManager.getLabeledAccounts();
    expect(Object.keys(labeled).sort()).toEqual(["alice", "bob"]);
  });

  it("hasLabel reflects the label map state", () => {
    expect(AccountManager.hasLabel("alice")).toBe(false);
    AccountManager.createAccount("alice");
    expect(AccountManager.hasLabel("alice")).toBe(true);
  });

  it("getOrCreateLabeled returns the existing labeled account on second call", () => {
    const first = AccountManager.getOrCreateLabeled("alice");
    const second = AccountManager.getOrCreateLabeled("alice");
    expect(second.accountAddress.toString()).toBe(first.accountAddress.toString());
    expect(AccountManager.getPoolSize()).toBe(1);
  });

  it("createBatch creates one account per label and returns the map", () => {
    const accounts = AccountManager.createBatch(["alice", "bob", "charlie"]);
    expect(Object.keys(accounts).sort()).toEqual(["alice", "bob", "charlie"]);
    expect(AccountManager.getPoolSize()).toBe(3);
  });

  it("getAllAccounts returns every account in insertion order", () => {
    const a = AccountManager.createAccount("alice");
    const b = AccountManager.createAccount("bob");
    const all = AccountManager.getAllAccounts();
    expect(all).toHaveLength(2);
    const addrs = all.map((acc) => acc.accountAddress.toString());
    expect(addrs).toContain(a.accountAddress.toString());
    expect(addrs).toContain(b.accountAddress.toString());
  });

  it("clearPool resets pool, label map, and poolLoaded flag", () => {
    AccountManager.createAccount("alice");
    expect(AccountManager.getPoolSize()).toBe(1);
    AccountManager.clearPool();
    expect(AccountManager.getPoolSize()).toBe(0);
    expect(AccountManager.hasLabel("alice")).toBe(false);
  });
});

describe("AccountManager — load from env / key / config", () => {
  let origEnv: string | undefined;

  beforeEach(() => {
    AccountManager.clearPool();
    origEnv = process.env.PRIVATE_KEY;
    delete process.env.PRIVATE_KEY;
  });

  afterEach(() => {
    AccountManager.clearPool();
    if (origEnv === undefined) delete process.env.PRIVATE_KEY;
    else process.env.PRIVATE_KEY = origEnv;
  });

  it("loadAccountFromEnv reads from PRIVATE_KEY by default", () => {
    process.env.PRIVATE_KEY = TEST_KEY_A;
    const acc = AccountManager.loadAccountFromEnv();
    expect(acc.accountAddress.toString()).toMatch(/^0x[a-f0-9]+$/i);
  });

  it("loadAccountFromEnv reads from a custom env var name", () => {
    process.env.MY_CUSTOM_KEY = TEST_KEY_A;
    try {
      const acc = AccountManager.loadAccountFromEnv("MY_CUSTOM_KEY");
      expect(acc.accountAddress.toString()).toMatch(/^0x[a-f0-9]+$/i);
    } finally {
      delete process.env.MY_CUSTOM_KEY;
    }
  });

  it("loadAccountFromEnv throws when the env var is unset", () => {
    expect(() => AccountManager.loadAccountFromEnv("DEFINITELY_NOT_SET")).toThrow(
      /not found/
    );
  });

  it("loadAccountFromPrivateKey adds the account to the pool", () => {
    expect(AccountManager.getPoolSize()).toBe(0);
    AccountManager.loadAccountFromPrivateKey(TEST_KEY_A);
    expect(AccountManager.getPoolSize()).toBe(1);
  });

  it("loadAccountsFromConfig loads every valid key", () => {
    const config = {
      allAccounts: [TEST_KEY_A, TEST_KEY_B],
    } as unknown as MovehatConfig;
    const accounts = AccountManager.loadAccountsFromConfig(config);
    expect(accounts).toHaveLength(2);
  });

  it("loadAccountsFromConfig warns on a malformed key and skips it", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = {
      allAccounts: [TEST_KEY_A, "not-a-real-key"],
    } as unknown as MovehatConfig;
    const accounts = AccountManager.loadAccountsFromConfig(config);
    expect(accounts).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to load account from config/)
    );
    warnSpy.mockRestore();
  });
});

describe("AccountManager.loadAccountPool / exportPrivateKeys", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-acc-load-"));
    AccountManager.clearPool();
  });

  afterEach(() => {
    AccountManager.clearPool();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("loadAccountPool returns false when the file does not exist", () => {
    expect(AccountManager.loadAccountPool(tmpDir)).toBe(false);
  });

  it("loadAccountPool restores accounts and labels from disk", () => {
    // Plant a pool via save → clear → load round-trip.
    AccountManager.createAccount("alice");
    AccountManager.createAccount("bob");
    const poolDir = join(tmpDir, "accounts");
    AccountManager.saveAccountPool(poolDir);
    AccountManager.clearPool();
    expect(AccountManager.getPoolSize()).toBe(0);

    const ok = AccountManager.loadAccountPool(poolDir);
    expect(ok).toBe(true);
    expect(AccountManager.getPoolSize()).toBe(2);
    expect(AccountManager.hasLabel("alice")).toBe(true);
    expect(AccountManager.hasLabel("bob")).toBe(true);
  });

  it("loadAccountPool is a no-op when poolLoaded is already true", () => {
    AccountManager.createAccount("alice");
    const poolDir = join(tmpDir, "accounts");
    AccountManager.saveAccountPool(poolDir);
    expect(AccountManager.loadAccountPool(poolDir)).toBe(true);
    // Second call short-circuits via the poolLoaded flag.
    expect(AccountManager.loadAccountPool(poolDir)).toBe(true);
  });

  it("loadAccountPool returns false and warns on corrupt JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const poolDir = join(tmpDir, "accounts");
    // mkdir then write a deliberately malformed test-pool.json.
    AccountManager.createAccount("alice");
    AccountManager.saveAccountPool(poolDir);
    writeFileSync(join(poolDir, "test-pool.json"), "{ not valid json");
    AccountManager.clearPool();
    expect(AccountManager.loadAccountPool(poolDir)).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to load account pool/)
    );
    warnSpy.mockRestore();
  });

  it("exportPrivateKeys returns every labeled account's key when called with no args", () => {
    AccountManager.createAccount("alice");
    AccountManager.createAccount("bob");
    const exported = AccountManager.exportPrivateKeys();
    expect(Object.keys(exported).sort()).toEqual(["alice", "bob"]);
    for (const key of Object.values(exported)) {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("exportPrivateKeys filters by labels when an array is passed", () => {
    AccountManager.createAccount("alice");
    AccountManager.createAccount("bob");
    AccountManager.createAccount("charlie");
    const exported = AccountManager.exportPrivateKeys(["alice", "charlie"]);
    expect(Object.keys(exported).sort()).toEqual(["alice", "charlie"]);
  });

  it("exportPrivateKeys with an unknown label returns an empty map", () => {
    const exported = AccountManager.exportPrivateKeys(["missing"]);
    expect(exported).toEqual({});
  });
});
