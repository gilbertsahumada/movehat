import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Harness } from "../../harness/index.js";
import { initRuntime } from "../../runtime.js";
import { AccountManager } from "../../core/AccountManager.js";
import { setupHarnessTestFixture, type HarnessTestFixture } from "./_fixture.js";

/**
 * M9.2 — Harness.accounts + runtime.accountManager wiring.
 *
 * Verifies the user-facing F8(a) fix that M9.2 unlocks: each Harness
 * owns a per-instance AccountManager, and `harness.accounts` is a
 * snapshot of that manager's labeled accounts. Two runtimes built with
 * separate `AccountManager` instances do NOT share label state (the
 * static facade's process-wide collision is bypassed).
 *
 * Live-mode coverage only — `Harness.createLocal` / `createFork` spin
 * up real infrastructure (movement node / fork server) and live in the
 * integration tier. The wiring being tested here (snapshot from
 * runtime.accountManager.getLabeledAccounts()) is identical across all
 * three modes, so live-mode is a sufficient unit-level proof.
 */
describe("Harness.accounts + runtime.accountManager (M9.2, #279)", () => {
  let fixture: HarnessTestFixture;

  beforeEach(() => {
    fixture = setupHarnessTestFixture();
  });

  afterEach(() => {
    fixture.teardown();
  });

  it("exposes the constructed AccountManager via runtime.accountManager", async () => {
    const harness = await Harness.createLive("testnet");
    try {
      expect(harness.runtime.accountManager).toBeInstanceOf(AccountManager);
      // The runtime constructed its own AccountManager (no caller-supplied
      // option threaded in via createLive).
      expect(typeof harness.runtime.accountManager.getLabeledAccounts).toBe(
        "function",
      );
      expect(typeof harness.runtime.accountManager.createAccount).toBe(
        "function",
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("harness.accounts is empty {} for createLive (no labels in config-driven account loading)", async () => {
    const harness = await Harness.createLive("testnet");
    try {
      expect(harness.accounts).toEqual({});
    } finally {
      await harness.cleanup();
    }
  });

  it("InitRuntimeOptions.accountManager threads a pre-seeded manager onto the runtime", async () => {
    // Caller pre-creates the manager, seeds it, then passes to initRuntime.
    // The returned runtime.accountManager === the passed instance, so the
    // pre-existing labels survive.
    const mgr = new AccountManager();
    mgr.createAccount("alice");
    mgr.createAccount("bob");
    const seededSize = mgr.getPoolSize(); // 2

    const runtime = await initRuntime({
      network: "testnet",
      accountManager: mgr,
    });

    // Identity check: the runtime's manager IS the caller's instance.
    expect(runtime.accountManager).toBe(mgr);

    // The pre-seeded labels survive.
    expect(runtime.accountManager.hasLabel("alice")).toBe(true);
    expect(runtime.accountManager.hasLabel("bob")).toBe(true);

    // initRuntime additionally calls loadAccountsFromConfig(config), which
    // loads the fixture's explicit testnet account and adds it to
    // the same manager. Pool size = seeded + config-loaded.
    expect(runtime.accountManager.getPoolSize()).toBe(seededSize + 1);
  });

  it("two runtimes with separate AccountManager instances have isolated label maps", async () => {
    // The user-facing F8(a) fix: two harnesses no longer silently shadow
    // each other's account labels. Verified at the runtime layer here
    // (the cheap path); the Harness layer just snapshots whatever
    // runtime.accountManager.getLabeledAccounts() returns.
    const mgr1 = new AccountManager();
    const mgr2 = new AccountManager();

    const alice1 = mgr1.createAccount("alice");
    const alice2 = mgr2.createAccount("alice");

    const r1 = await initRuntime({ network: "testnet", accountManager: mgr1 });
    const r2 = await initRuntime({ network: "testnet", accountManager: mgr2 });

    // The two runtimes resolve "alice" to DIFFERENT accounts.
    const a1 = r1.accountManager.getAccountByLabel("alice");
    const a2 = r2.accountManager.getAccountByLabel("alice");

    expect(a1!.accountAddress.toString()).toBe(alice1.accountAddress.toString());
    expect(a2!.accountAddress.toString()).toBe(alice2.accountAddress.toString());
    expect(a1!.accountAddress.toString()).not.toBe(
      a2!.accountAddress.toString(),
    );

    // Pool sizes are independent. Each manager has its 1 pre-seeded
    // "alice" + 1 config-loaded auto-generated test key (from
    // initRuntime → loadAccountsFromConfig on a testnet config with no
    // explicit accounts).
    expect(r1.accountManager.getPoolSize()).toBe(2);
    expect(r2.accountManager.getPoolSize()).toBe(2);
  });

  it("runtime.createAccount() adds to runtime.accountManager (per-instance, not the static singleton)", async () => {
    const harness = await Harness.createLive("testnet");
    try {
      const before = harness.runtime.accountManager.getPoolSize();
      const a = harness.runtime.createAccount();
      const b = harness.runtime.createAccount();

      expect(harness.runtime.accountManager.getPoolSize()).toBe(before + 2);
      expect(a.accountAddress.toString()).not.toBe(
        b.accountAddress.toString(),
      );

      // The new accounts are in THIS runtime's pool — getAllAccounts()
      // returns them.
      const all = harness.runtime.accountManager.getAllAccounts();
      const addresses = all.map((acc) => acc.accountAddress.toString());
      expect(addresses).toContain(a.accountAddress.toString());
      expect(addresses).toContain(b.accountAddress.toString());

      // harness.accounts is a SNAPSHOT — late additions do NOT appear.
      // (Documented as Hardhat-style ergonomics in the Harness JSDoc.)
      expect(Object.values(harness.accounts)).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });
});
