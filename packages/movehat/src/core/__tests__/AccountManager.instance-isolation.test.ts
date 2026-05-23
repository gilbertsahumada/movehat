import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AccountManager } from "../AccountManager.js";

/**
 * Per-instance isolation contract introduced in M9.1 (#277, tracks #270)
 * and made the SOLE contract in M9.4 / 0.3.0 (static facade removed).
 *
 * What we pin:
 *   - Two `new AccountManager()` instances have fully isolated pools,
 *     labelMaps, and private-key maps. Re-using a label across instances
 *     does NOT collide.
 *   - An explicit `poolPath` is honored on save.
 *   - The default `poolPath` is evaluated LAZILY on each call —
 *     `process.chdir` between construction and save IS respected. (The
 *     legacy F8(b) eager-cwd-capture only ever applied to the removed
 *     static facade; instances never had that bug.)
 */
describe("AccountManager — per-instance isolation", () => {
  let cwdBackup: string;
  let tmpDir: string;

  beforeEach(() => {
    cwdBackup = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-instance-"));
  });

  afterEach(() => {
    if (process.cwd() !== cwdBackup) {
      process.chdir(cwdBackup);
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("two instances have independent label maps — re-using a label across instances does NOT collide", () => {
    const mgr1 = new AccountManager();
    const mgr2 = new AccountManager();

    const alice1 = mgr1.createAccount("alice");
    const alice2 = mgr2.createAccount("alice");

    expect(alice1.accountAddress.toString()).not.toBe(
      alice2.accountAddress.toString(),
    );

    const lookup1 = mgr1.getAccountByLabel("alice");
    const lookup2 = mgr2.getAccountByLabel("alice");
    expect(lookup1!.accountAddress.toString()).toBe(alice1.accountAddress.toString());
    expect(lookup2!.accountAddress.toString()).toBe(alice2.accountAddress.toString());

    expect(mgr1.getPoolSize()).toBe(1);
    expect(mgr2.getPoolSize()).toBe(1);
  });

  it("two instances do not share private keys, generated-account tracking, or pool entries", () => {
    const mgr1 = new AccountManager();
    const mgr2 = new AccountManager();

    mgr1.createAccount("shared_label");
    mgr2.createAccount("shared_label");

    const keys1 = mgr1.exportPrivateKeys();
    const keys2 = mgr2.exportPrivateKeys();
    expect(keys1.shared_label).toBeDefined();
    expect(keys2.shared_label).toBeDefined();
    expect(keys1.shared_label).not.toBe(keys2.shared_label);

    const all1 = mgr1.getAllAccounts();
    const all2 = mgr2.getAllAccounts();
    expect(all1).toHaveLength(1);
    expect(all2).toHaveLength(1);
    expect(all1[0]!.accountAddress.toString()).not.toBe(
      all2[0]!.accountAddress.toString(),
    );
  });

  it("explicit poolPath option lands saveAccountPool() at the configured directory", () => {
    const explicit = join(tmpDir, "explicit-instance-pool");
    const mgr = new AccountManager({ poolPath: explicit });

    mgr.createAccount("carol");
    mgr.saveAccountPool();

    expect(existsSync(join(explicit, "test-pool.json"))).toBe(true);
  });

  it("default poolPath is evaluated LAZILY — process.chdir between construction and save IS respected", () => {
    const mgr = new AccountManager();
    mgr.createAccount("late_chdir_account");

    process.chdir(tmpDir);
    mgr.saveAccountPool();

    const expectedAtNewCwd = join(tmpDir, ".movehat", "accounts", "test-pool.json");
    expect(existsSync(expectedAtNewCwd)).toBe(true);
  });
});
