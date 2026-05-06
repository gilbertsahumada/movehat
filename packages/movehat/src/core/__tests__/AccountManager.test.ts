import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, existsSync } from "fs";
import { tmpdir, platform } from "os";
import { join } from "path";
import { AccountManager } from "../AccountManager.js";

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
