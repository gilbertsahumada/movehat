import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Harness, HarnessDisposedError } from "../../harness/index.js";
import { _resetConfigCache } from "../../core/config.js";

/**
 * Proxy poisoning is the load-bearing safety guarantee of M2: once a
 * Harness has been cleaned up, any further deploy / view / script /
 * upgrade call must throw `HarnessDisposedError` synchronously on
 * property access — not after the awaited method body. These tests
 * lock that contract.
 *
 * Uses `Harness.createLive(network)` because it does not spawn a real
 * Movement node — `initRuntime` only constructs the SDK client (no RPC
 * round-trip) from the fixture config. `createLocal` / `createFork`
 * runtime tests live in the M4 integration suite where spinning a real
 * node is acceptable.
 */
describe("Harness — proxy poisoning", () => {
  let tmpCwd: string;
  let origCwd: string;

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-harness-test-"));
    writeFileSync(
      join(tmpCwd, "movehat.config.js"),
      `export default {
  defaultNetwork: "testnet",
  networks: {
    testnet: {
      url: "https://testnet.movementnetwork.xyz/v1",
      chainId: "testnet"
    }
  }
};
`
    );
    const moveDir = join(tmpCwd, "move");
    mkdirSync(join(moveDir, "sources"), { recursive: true });
    writeFileSync(
      join(moveDir, "Move.toml"),
      `[package]
name = "dummy"
version = "0.0.1"

[addresses]
`
    );
    writeFileSync(join(moveDir, "sources", "dummy.move"), "// intentionally empty\n");

    origCwd = process.cwd();
    process.chdir(tmpCwd);
    _resetConfigCache();
  });

  afterEach(() => {
    try {
      process.chdir(origCwd);
    } finally {
      if (existsSync(tmpCwd)) rmSync(tmpCwd, { recursive: true, force: true });
      _resetConfigCache();
    }
  });

  it("cleanup() flips poisoned to true", async () => {
    const harness = await Harness.createLive("testnet");
    expect(harness.poisoned).toBe(false);
    await harness.cleanup();
    expect(harness.poisoned).toBe(true);
  });

  it("cleanup() is idempotent", async () => {
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();
    // Second call must not throw and must leave the harness poisoned.
    await expect(harness.cleanup()).resolves.toBeUndefined();
    expect(harness.poisoned).toBe(true);
  });

  it("post-cleanup, deployCodeObject throws HarnessDisposedError synchronously on property access", async () => {
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();

    // Property access itself throws — the call site never gets a Promise back.
    expect(() => harness.deployCodeObject({})).toThrow(HarnessDisposedError);
  });

  it("post-cleanup, upgradeCodeObject / runViewFunction / runMoveScript all throw HarnessDisposedError synchronously", async () => {
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();

    expect(() => harness.upgradeCodeObject({})).toThrow(HarnessDisposedError);
    expect(() => harness.runViewFunction({})).toThrow(HarnessDisposedError);
    expect(() => harness.runMoveScript({})).toThrow(HarnessDisposedError);
  });

  it("HarnessDisposedError carries the offending method name", async () => {
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();

    let captured: unknown;
    try {
      harness.deployCodeObject({});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(HarnessDisposedError);
    expect((captured as HarnessDisposedError).methodName).toBe("deployCodeObject");
  });

  it("post-cleanup, metadata accessors (mode, poisoned, runtime) still work", async () => {
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();

    // None of these should throw — only the 4 poisoned methods do.
    expect(harness.mode).toBe("live");
    expect(harness.poisoned).toBe(true);
    expect(harness.runtime).toBeDefined();
  });

  it("before cleanup, the 4 stub methods reject (real impls in M2.2/M2.3) — but do NOT throw HarnessDisposedError", async () => {
    const harness = await Harness.createLive("testnet");
    try {
      await expect(harness.deployCodeObject({})).rejects.toThrow(/not yet implemented/);
      await expect(harness.upgradeCodeObject({})).rejects.toThrow(/not yet implemented/);
      await expect(harness.runViewFunction({})).rejects.toThrow(/not yet implemented/);
      await expect(harness.runMoveScript({})).rejects.toThrow(/not yet implemented/);
    } finally {
      await harness.cleanup();
    }
  });

  it("await harness.someAsyncMethod() pattern: post-cleanup throw happens before await", async () => {
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();

    // The error is synchronous (property access), but the typical caller
    // shape uses await. Confirm that pattern surfaces the error too.
    let captured: unknown;
    try {
      await harness.deployCodeObject({});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(HarnessDisposedError);
  });
});
