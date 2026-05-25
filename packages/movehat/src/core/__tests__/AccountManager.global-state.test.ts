import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AccountManager } from "../AccountManager.js";

/**
 * F8 — Document the two known limitations of `AccountManager`:
 *
 *   (a) State is class-static. Two harness "sessions" in the same
 *       process share the pool, the labelMap, and the private-key
 *       map. A label re-used across sessions overwrites the entry.
 *       This is intentional per `Harness.ts:39-42` ("Two Harness
 *       instances in the same process share account labels"). This
 *       test captures the contract so a future refactor cannot
 *       silently change it.
 *
 *   (b) `defaultPoolPath = join(process.cwd(), ".movehat", "accounts")`
 *       is evaluated when the module is first imported, NOT lazily on
 *       each call. Changing `process.cwd()` after import does not move
 *       the save destination. Callers needing per-test isolation must
 *       pass an explicit `poolPath` argument.
 */

describe("F8 — AccountManager static state and import-time cwd capture", () => {
  let cwdBackup: string;
  let tmpDir: string;

  beforeEach(() => {
    AccountManager.clearPool();
    cwdBackup = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-f8-"));
  });

  afterEach(() => {
    AccountManager.clearPool();
    if (process.cwd() !== cwdBackup) {
      process.chdir(cwdBackup);
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("(a) re-creating an account with an existing label overwrites the labelMap entry", () => {
    const first = AccountManager.createAccount("alice");
    const second = AccountManager.createAccount("alice");
    expect(second.accountAddress.toString()).not.toBe(
      first.accountAddress.toString()
    );

    const lookup = AccountManager.getAccountByLabel("alice");
    expect(lookup).toBeDefined();
    expect(lookup!.accountAddress.toString()).toBe(
      second.accountAddress.toString()
    );
    // The first account is still in the pool (keyed by address), only
    // the label binding moved. A second harness session that creates
    // its own "alice" will silently shadow the first — this is the
    // documented Harness limitation. exportPrivateKeys reflects the
    // current label binding (i.e. the second account).
    const exportedKeys = AccountManager.exportPrivateKeys(["alice"]);
    expect(exportedKeys.alice).toBeTypeOf("string");
    expect(exportedKeys.alice!.length).toBeGreaterThan(0);
  });

  it("(b) saveAccountPool ignores a process.chdir after import; defaults to the import-time cwd", () => {
    AccountManager.createAccount("bob");

    process.chdir(tmpDir);
    // No path argument → uses defaultPoolPath, which was set at module
    // load time before this chdir.
    AccountManager.saveAccountPool();

    // The pool file must NOT appear under the freshly-chdir'd cwd.
    const expectedAtNewCwd = join(tmpDir, ".movehat", "accounts", "test-pool.json");
    expect(existsSync(expectedAtNewCwd)).toBe(false);

    // Sanity check: explicit poolPath does land where the caller asked.
    const explicit = join(tmpDir, "explicit");
    AccountManager.saveAccountPool(explicit);
    expect(existsSync(join(explicit, "test-pool.json"))).toBe(true);
  });
});

/**
 * M9.1 — per-instance API additive coverage.
 *
 * Validates the new `new AccountManager(options?)` shape introduced by
 * M9.1 (#277, tracks #270). The F8 assertions above continue to pin the
 * legacy static-facade behavior (preserved through the deprecation window
 * via a module-level singleton). These tests pin the NEW shape:
 *
 *   - Two instances have fully isolated pools / labelMaps / private keys.
 *   - An explicit `poolPath` honored on save.
 *   - Default `poolPath` evaluated LAZILY on each call — `process.chdir`
 *     between construction and save IS respected (the inverse of F8(b),
 *     which only applied to the static facade and stays preserved above).
 *
 * When M9.4 removes the static facade in 0.3.0, the F8 block above goes
 * away and only this block remains.
 */
describe("AccountManager — per-instance isolation (M9.1, #277)", () => {
  let cwdBackup: string;
  let tmpDir: string;

  beforeEach(() => {
    cwdBackup = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-m9.1-"));
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

    // Two distinct accounts — neither labelMap was touched by the other.
    expect(alice1.accountAddress.toString()).not.toBe(
      alice2.accountAddress.toString(),
    );

    // Each instance resolves "alice" to its own account.
    const lookup1 = mgr1.getAccountByLabel("alice");
    const lookup2 = mgr2.getAccountByLabel("alice");
    expect(lookup1!.accountAddress.toString()).toBe(alice1.accountAddress.toString());
    expect(lookup2!.accountAddress.toString()).toBe(alice2.accountAddress.toString());

    // Pool sizes are independent.
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

    // mgr2's account is NOT visible from mgr1's getAllAccounts.
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
    // Construct with NO explicit poolPath BEFORE chdir.
    const mgr = new AccountManager();
    mgr.createAccount("late_chdir_account");

    // Now chdir. The instance's `poolPath` getter resolves to this
    // fresh cwd at the moment of save — the legacy F8(b) bug
    // (cwd captured at import time) does NOT apply to instances.
    process.chdir(tmpDir);
    mgr.saveAccountPool();

    const expectedAtNewCwd = join(tmpDir, ".movehat", "accounts", "test-pool.json");
    expect(existsSync(expectedAtNewCwd)).toBe(true);
  });

  it("static facade still routes to a shared singleton — confirms back-compat path is wired", () => {
    // This is a meta-assertion: the static API exists, is callable, and
    // operates on a single shared state across calls. Without this guard,
    // a future refactor could silently break the deprecation window.
    AccountManager.clearPool();
    expect(AccountManager.getPoolSize()).toBe(0);

    AccountManager.createAccount("singleton_meta");
    expect(AccountManager.getPoolSize()).toBe(1);
    expect(AccountManager.hasLabel("singleton_meta")).toBe(true);

    AccountManager.clearPool();
  });
});
