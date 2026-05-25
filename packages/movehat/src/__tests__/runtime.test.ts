import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initRuntime } from "../runtime.js";
import { _resetConfigCache } from "../core/config.js";
import { AccountManager } from "../core/AccountManager.js";

/**
 * Behavioral tests for `runtime.ts` covering the paths
 * `__tests__/deployContract.test.ts` doesn't exercise:
 *   - initRuntime returns a fully-wired MovehatRuntime
 *   - accountIndex selection + out-of-range error
 *   - config override merging
 *   - getAccountByIndex bounds error
 *   - switchNetwork delegates back into initRuntime
 *
 * Mainnet/security gates live in `resolveNetworkConfig` and are
 * covered in `core/__tests__/config.test.ts` to avoid re-driving the
 * same branch through two layers.
 */

const TEST_KEY_A =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const TEST_KEY_B =
  "0x0000000000000000000000000000000000000000000000000000000000000002";

function writeConfig(cwd: string, body: string): void {
  writeFileSync(join(cwd, "movehat.config.js"), body);
}

const CONFIG_TWO_NETWORKS_TWO_ACCOUNTS = `export default {
  defaultNetwork: "testnet",
  networks: {
    testnet: {
      url: "https://testnet.movementnetwork.xyz/v1",
      chainId: "testnet",
      accounts: ["${TEST_KEY_A}", "${TEST_KEY_B}"]
    },
    custom: {
      url: "https://custom.example.com/v1",
      chainId: "custom",
      accounts: ["${TEST_KEY_A}"]
    }
  }
};
`;

describe("initRuntime", () => {
  let tmpCwd: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-runtime-test-"));
    process.chdir(tmpCwd);
    _resetConfigCache();
    AccountManager.clearPool();
    writeConfig(tmpCwd, CONFIG_TWO_NETWORKS_TWO_ACCOUNTS);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpCwd, { recursive: true, force: true });
    _resetConfigCache();
    AccountManager.clearPool();
  });

  it("returns a runtime bound to defaultNetwork when no network is passed", async () => {
    const runtime = await initRuntime();

    expect(runtime.network.name).toBe("testnet");
    expect(runtime.network.rpc).toContain("testnet.movementnetwork.xyz");
    expect(runtime.config.network).toBe("testnet");
    expect(runtime.aptos).toBeDefined();
    expect(runtime.account).toBeDefined();
    // accounts array reflects both keys configured.
    expect(runtime.accounts).toHaveLength(2);
  });

  it("switches network via the `network` option", async () => {
    const runtime = await initRuntime({ network: "custom" });

    expect(runtime.network.name).toBe("custom");
    expect(runtime.network.rpc).toContain("custom.example.com");
    expect(runtime.accounts).toHaveLength(1);
  });

  it("selects a specific account via `accountIndex`", async () => {
    const runtime = await initRuntime({ accountIndex: 1 });

    // The primary `account` is the indexed pick.
    expect(runtime.account.accountAddress.toString()).toBe(
      runtime.accounts[1]!.accountAddress.toString()
    );
    expect(runtime.account.accountAddress.toString()).not.toBe(
      runtime.accounts[0]!.accountAddress.toString()
    );
  });

  it("throws a clear error when accountIndex is out of range", async () => {
    await expect(initRuntime({ accountIndex: 5 })).rejects.toThrow(
      /Account index 5 not found/
    );
  });

  it("merges `configOverride` on top of the loaded user config", async () => {
    const runtime = await initRuntime({
      configOverride: { defaultNetwork: "custom" },
    });

    // The override flips defaultNetwork → 'custom' so resolveNetworkConfig
    // picks the custom entry without requiring an explicit `network` arg.
    expect(runtime.network.name).toBe("custom");
  });

  it("getAccountByIndex returns the account at the given slot", async () => {
    const runtime = await initRuntime();
    expect(runtime.getAccountByIndex(0).accountAddress.toString()).toBe(
      runtime.accounts[0]!.accountAddress.toString()
    );
    expect(runtime.getAccountByIndex(1).accountAddress.toString()).toBe(
      runtime.accounts[1]!.accountAddress.toString()
    );
  });

  it("getAccountByIndex throws on out-of-range index", async () => {
    const runtime = await initRuntime();
    expect(() => runtime.getAccountByIndex(99)).toThrow(
      /Account index 99 out of range/
    );
  });

  it("createAccount returns a fresh account each call (pool grows)", async () => {
    const runtime = await initRuntime();
    // Pool size is measured on the runtime's OWN AccountManager — not on
    // the static facade's singleton. M9.2 made each runtime own its
    // per-instance manager; `runtime.createAccount()` adds to that
    // instance's pool, not the shared singleton.
    const before = runtime.accountManager.getPoolSize();
    const a = runtime.createAccount();
    const b = runtime.createAccount();
    expect(a.accountAddress.toString()).not.toBe(b.accountAddress.toString());
    expect(runtime.accountManager.getPoolSize()).toBe(before + 2);
  });

  it("getAccount loads from a private key hex", async () => {
    const runtime = await initRuntime();
    const acc = runtime.getAccount(TEST_KEY_B);
    expect(acc.accountAddress.toString()).toBe(
      runtime.accounts[1]!.accountAddress.toString()
    );
  });

  it("switchNetwork returns a new runtime bound to the requested network", async () => {
    const runtime = await initRuntime();
    expect(runtime.network.name).toBe("testnet");

    const switched = await runtime.switchNetwork("custom");
    expect(switched.network.name).toBe("custom");
    expect(switched.network.rpc).toContain("custom.example.com");
    // Original runtime is unaffected — switchNetwork builds fresh.
    expect(runtime.network.name).toBe("testnet");
  });

  it("switchNetwork preserves a caller-supplied accountManager across the network switch", async () => {
    // M9.2 wired `accountManager` through InitRuntimeOptions. The
    // switchNetwork closure spreads `...options` into the recursive
    // initRuntime call, so a caller-supplied manager survives the
    // switch (labels created on it are still visible). Without this
    // spread, the new runtime would default-construct a fresh manager
    // and labels would silently disappear post-switch. This test pins
    // the spread behavior — refactoring switchNetwork to drop it must
    // fail here, not in a downstream user's test suite.
    const mgr = new AccountManager();
    mgr.createAccount("alice");

    const runtime = await initRuntime({ accountManager: mgr });
    expect(runtime.accountManager).toBe(mgr);
    expect(runtime.accountManager.hasLabel("alice")).toBe(true);

    const switched = await runtime.switchNetwork("custom");
    expect(switched.accountManager).toBe(mgr);
    expect(switched.accountManager.hasLabel("alice")).toBe(true);
  });

  it("getDeployment / getDeployments / getDeploymentAddress return null/empty for an unused network", async () => {
    const runtime = await initRuntime();
    // Nothing deployed in the tmp cwd, so these all short-circuit.
    expect(runtime.getDeployment("counter")).toBeNull();
    expect(runtime.getDeployments()).toEqual({});
    expect(runtime.getDeploymentAddress("counter")).toBeNull();
  });

  it("getContract returns a MoveContract bound to the requested address+module", async () => {
    const runtime = await initRuntime();
    const dummyAddr = "0x" + "a".repeat(64);
    const contract = runtime.getContract(dummyAddr, "counter");
    expect(contract).toBeDefined();
    // MoveContract holds the address+module pair; assert shape, not behavior
    // (call/view would require a real chain).
    expect(contract).toHaveProperty("call");
    expect(contract).toHaveProperty("view");
  });
});

