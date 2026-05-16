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
